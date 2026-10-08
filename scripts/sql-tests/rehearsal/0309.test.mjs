// 0309: the client sees one plain line when their coach moves them to a new phase. New notification type added to the list the database already has; the trigger function is closed.
export default {
  name: "0309 new training block notice",
  migrations: ["0309"],
  phases: {
    async "0309"({ db, h }) {
      const coach = await h.user("NB Coach");
      const ann = await h.user("NB Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "NB group");
      await h.member(group, ann);

      await h.asSuper();
      const def = await h.one("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'");
      h.check("the new notification type is in the list, and the older types are still there", /new_training_block/.test(def.def) && /nutrition_target_changed|nutrition_prompt_answered/.test(def.def) && /'comment'/.test(def.def), def.def);
      const closed = await h.one("select has_function_privilege('authenticated', 'public.notify_on_new_training_block()', 'execute') as a, has_function_privilege('anon', 'public.notify_on_new_training_block()', 'execute') as n");
      h.check("the notice function is closed to signed-in users and signed-out visitors", closed.a === false && closed.n === false, JSON.stringify(closed));

      const notices = async () => {
        await h.asSuper();
        return h.rows("select profile_id, body, link_path, read_at is not null as is_read from public.notifications where type = 'new_training_block' and group_id = $1 order by created_at", [group]);
      };
      // the plan is first created (an insert): nobody is told
      await h.as(coach);
      await db.query("insert into public.client_phase_plans (athlete_id, group_id, phase, started_on, updated_by) values ($1, $2, 'fat_loss', current_date - 20, $3)", [ann, group, coach]);
      h.check("a client's plan being created tells nobody", (await notices()).length === 0);

      // only the review date moves: nobody is told
      await h.as(coach);
      await db.query("update public.client_phase_plans set review_on = current_date + 14 where athlete_id = $1 and group_id = $2", [ann, group]);
      h.check("moving the review date tells nobody", (await notices()).length === 0);

      // the coach moves the phase: the client is told once, in plain words
      await h.as(coach);
      await db.query("insert into public.client_phase_plans (athlete_id, group_id, phase, started_on, updated_by) values ($1, $2, 'reverse_diet', current_date, $3) on conflict (athlete_id, group_id) do update set phase = excluded.phase, started_on = excluded.started_on, review_on = null, planned_next_phase = null", [ann, group, coach]);
      const n1 = await notices();
      h.check("the CLIENT is told, once, with a plain line and a link home", n1.length === 1 && n1[0].profile_id === ann && n1[0].body === "Your coach started a new training block with you." && n1[0].link_path === `/groups/${group}`, JSON.stringify(n1));
      h.check("the line has no phase words", !/phase|reverse|deficit|cut|bulk|maintenance|calorie/i.test(n1[0].body));

      // a second move while the first is unread folds into it
      await h.as(coach);
      await db.query("update public.client_phase_plans set phase = 'maintenance' where athlete_id = $1 and group_id = $2", [ann, group]);
      h.check("a second move while the first is unread does not tell them twice", (await notices()).length === 1);

      // after they read it, a later move tells them again
      await h.asSuper();
      await db.query("update public.notifications set read_at = now() where type = 'new_training_block' and profile_id = $1", [ann]);
      await h.as(coach);
      await db.query("update public.client_phase_plans set phase = 'fat_loss' where athlete_id = $1 and group_id = $2", [ann, group]);
      h.check("after it is read, a later move tells them again", (await notices()).length === 2);

      // the client's own confirmation causing the change does not tell them (they already know)
      await h.as(ann);
      let own = null;
      try {
        await db.query("update public.client_phase_plans set phase = 'hypertrophy' where athlete_id = $1 and group_id = $2", [ann, group]);
      } catch (e) {
        own = String(e.message).split("\n")[0];
      }
      await h.asSuper();
      h.check("the client has no write access to the plan, and a change made on their own behalf tells nobody new", (await notices()).length === 2, own ?? "");
    },
  },
};
