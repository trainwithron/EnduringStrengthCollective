// 0308: every trigger function that signed-in users could run by default is closed to the public and signed-in users, and every trigger still fires for a signed-in client, a coach and
// the service role. The undo (the file's own grant statements) puts each back exactly as it was.
import { readFileSync } from "node:fs";
import { TRIGGER_SWEEP, triggerSweepUndoSql } from "../../function-acl.mjs";

const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const dayKey = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export default {
  name: "0308 trigger functions closed",
  migrations: ["0308"],
  phases: {
    async "0308"({ db, h }) {
      await h.asSuper();
      // The migration text and the reviewed list are the same list.
      const text = readFileSync(new URL("../../../supabase/migrations/0308_close_trigger_functions.sql", import.meta.url), "utf8");
      const named = [...text.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).filter((n) => n !== "public");
      h.check("the migration names exactly the reviewed list of trigger functions", named.length === TRIGGER_SWEEP.length && TRIGGER_SWEEP.every((n) => named.includes(n)), `${named.length} vs ${TRIGGER_SWEEP.length}`);

      // After the sweep: nothing in the list, and no trigger function at all, can be run by a signed-in user or a signed-out visitor; the server and the owner still can.
      const open = await h.rows(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
      h.check("no trigger function in the public schema can be run by a signed-in user or a signed-out visitor", open.length === 0, JSON.stringify(open.map((r) => r.proname)));
      const present = await h.rows(`select p.proname, has_function_privilege('service_role', p.oid, 'execute') as svc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any ($1)`, [TRIGGER_SWEEP]);
      h.check("the server keeps the right to run them (" + present.length + " of the list exist here)", present.length > 30 && present.every((r) => r.svc), JSON.stringify(present.filter((r) => !r.svc)));

      // The triggers still fire, for a signed-in client, a coach and the service role.
      const coach = await h.user("TF Coach");
      const ann = await h.user("TF Ann");
      const bob = await h.user("TF Bob");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "TF group");
      await h.member(group, ann);
      await h.member(group, bob);

      // A signed-in client: guard_client_nutrition_preferences keeps the coach-only rules at their defaults, and notify_on_nutrition_preferences tells the coach.
      await h.as(ann);
      const saved = await tryQ(db, `insert into public.client_nutrition_preferences (athlete_id, allergies, diet_type, protein_g_per_lb) values ($1, array['peanut'], 'vegan', 1.4) returning diet_type, protein_g_per_lb`, [ann]);
      h.check("a signed-in client's own save runs the guard trigger (coach-only rules stay at their defaults)", !saved.error && saved.rows[0].diet_type === "omnivore" && Number(saved.rows[0].protein_g_per_lb) === 1, JSON.stringify(saved));
      await h.asSuper();
      const told = await h.rows(`select profile_id from public.notifications where type = 'nutrition_preferences_changed' and group_id = $1`, [group]);
      h.check("and the notice trigger told the coach", told.length === 1 && told[0].profile_id === coach, JSON.stringify(told));

      // A signed-in member comments on another member's post: notify_on_comment (a different trigger) tells the post's author.
      await h.as(ann);
      const post = await tryQ(db, `insert into public.posts (group_id, author_id, body) values ($1, $2, 'hello') returning id`, [group, ann]);
      await h.as(bob);
      const comment = await tryQ(db, `insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'nice') returning id`, [post.rows?.[0]?.id, group, bob]);
      h.check("a signed-in member can post and comment", !post.error && !comment.error, JSON.stringify({ post, comment }));
      await h.asSuper();
      const commentNotice = await h.rows(`select profile_id from public.notifications where type = 'comment' and group_id = $1`, [group]);
      h.check("notify_on_comment still fires for a signed-in commenter", commentNotice.length === 1 && commentNotice[0].profile_id === ann, JSON.stringify(commentNotice));

      // A coach: applying a new target still tells the client (notify_on_target_change), and a signed-in person cannot make themselves a platform admin (prevent_platform_admin_self_escalation).
      await h.as(coach);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, $3, 2000, 150, 200, 60, $4)`, [ann, group, dayKey(-3), coach]);
      await db.query(`insert into public.client_macro_target_history (athlete_id, group_id, effective_from, calories, protein_g, carbs_g, fat_g, created_by) values ($1, $2, $3, 2200, 150, 200, 60, $4)`, [ann, group, dayKey(0), coach]);
      await h.asSuper();
      const targetNotice = await h.rows(`select profile_id from public.notifications where type = 'nutrition_target_changed' and group_id = $1`, [group]);
      h.check("a coach applying a new target still tells the client", targetNotice.length === 1 && targetNotice[0].profile_id === ann, JSON.stringify(targetNotice));

      await h.as(ann);
      await tryQ(db, `update public.profiles set is_platform_admin = true where id = $1`, [ann]);
      await h.asSuper();
      const stillNot = await h.one(`select is_platform_admin from public.profiles where id = $1`, [ann]);
      h.check("a signed-in person still can not make themselves a platform admin (the guard trigger fires)", stillNot.is_platform_admin !== true, JSON.stringify(stillNot));

      // The service role: the same guard lets the server do it (the trigger runs for the service role too).
      await h.asService();
      const asServer = await tryQ(db, `update public.profiles set is_platform_admin = true where id = $1 returning is_platform_admin`, [bob]);
      await h.asSuper();
      h.check("the service role still runs through the guard trigger and may change it", !asServer.error && asServer.rows[0].is_platform_admin === true, JSON.stringify(asServer));

      // The undo puts each back exactly as it was (owner, signed-in users, server: no signed-out visitor, as on the live database).
      await db.exec(triggerSweepUndoSql());
      const acl = await h.rows(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as a, has_function_privilege('service_role', p.oid, 'execute') as s from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and p.proname = any ($1)`, [TRIGGER_SWEEP]);
      h.check("the undo gives every one of them back to signed-in users, and the server still has them", acl.length === present.length && acl.every((r) => r.a && r.s), JSON.stringify(acl.filter((r) => !(r.a && r.s)).map((r) => r.proname)));
      // Close them again (the next phases and the paste test expect the closed state).
      await db.exec(text);
      const again = await h.rows(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute') and p.proname = any ($1)`, [TRIGGER_SWEEP]);
      h.check("running the migration again closes them again (it can be re-run)", again.length === 0, JSON.stringify(again));
    },
  },
};
