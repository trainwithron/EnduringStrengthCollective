// 0412: "Download my data" reads every table that names the signed-in person, a page at a time, each page its own call. Run AS the person, so row security still applies.
// The table and column asked for must be on the list; secrets and sign-in tokens are never in it.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0412 Download my data (everything, a page at a time)",
  migrations: ["0412"],
  phases: {
    async "0412"({ db, h }) {
      const owner = await h.user("EX Owner");
      const coach = await h.user("EX Coach");
      const ann = await h.user("EX Ann");
      const bo = await h.user("EX Bo");
      const org = await h.org(owner, "EX Gym");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "EX team");
      await h.member(g, ann);
      await h.member(g, bo);

      await h.asSuper();
      await db.query(`insert into public.body_weight_logs (athlete_id, group_id, weight) values ($1, $2, 161), ($3, $2, 222)`, [ann, g, bo]);
      await db.query(`insert into public.posts (group_id, author_id, post_type, channel, body) values ($1, $2, 'user_post', 'general', 'Ann wrote this'), ($1, $3, 'user_post', 'general', 'Bo wrote this')`, [g, ann, bo]);
      for (let i = 1; i <= 6; i++) await db.query(`insert into public.notifications (profile_id, type, body, link_path, created_at) values ($1, 'booking_request', $2, '/', now() - ($3 || ' minutes')::interval)`, [ann, `for Ann ${i}`, String(i)]);
      await db.query(`insert into public.notifications (profile_id, type, body, link_path) values ($1, 'booking_request', 'for Bo', '/')`, [bo]);
      await db.query(`insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_key) values ($1, 'https://push.example/ann', 'SECRETKEY-P256', 'SECRETKEY-AUTH')`, [ann]);
      await db.query(`insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'lift together?')`, [ann, bo]);

      const page = async (uid, table, col, offset = 0, limit = 1000) => {
        await h.as(uid);
        return (await db.query(`select public.export_my_data_table($1, $2, $3, $4) as d`, [table, col, offset, limit])).rows[0].d;
      };

      await h.as(ann);
      const list = (await db.query(`select tbl, col from public.export_my_data_tables()`)).rows.map((r) => `${r.tbl}.${r.col}`);
      h.check("the list includes her own profile, weight logs, posts and notices, found without anyone naming those tables", ["profiles.id", "body_weight_logs.athlete_id", "posts.author_id", "notifications.profile_id"].every((k) => list.includes(k)), list.join(","));
      h.check("it includes requests she sent or was sent, and invites addressed to her", ["training_partner_requests.from_athlete_id", "training_partner_requests.to_athlete_id", "space_invites.invited_profile_id", "organization_invites.invited_profile_id", "training_partner_blocks.blocker_id"].every((k) => list.includes(k)), list.join(","));
      h.check("the tables that hold only sign-in tokens and push keys are not on it", !list.some((k) => /^(push_subscriptions|wearable_oauth_tokens|google_calendar_oauth_tokens|guardian_links|kiosk_pins|coach_api_keys|pending_email_changes)\./.test(k)));

      const profile = await page(ann, "profiles", "id");
      h.check("her profile is in it", profile.rows.length === 1 && profile.rows[0].id === ann && profile.more === false);
      const weights = await page(ann, "body_weight_logs", "athlete_id");
      h.check("her weight log is in it, and only hers", weights.rows.length === 1 && Number(weights.rows[0].weight) === 161);
      const sent = await page(ann, "training_partner_requests", "from_athlete_id");
      h.check("a request she sent is in it", sent.rows.length === 1 && sent.rows[0].message === "lift together?");
      const nothing = await page(ann, "training_partner_requests", "to_athlete_id");
      h.check("a table where nothing names her returns an empty page", nothing.rows.length === 0 && nothing.more === false);

      // paging: newest first, a fixed order, nothing repeated or skipped
      const p1 = await page(ann, "notifications", "profile_id", 0, 4);
      const p2 = await page(ann, "notifications", "profile_id", 4, 4);
      const bodies = [...p1.rows, ...p2.rows].map((r) => r.body);
      h.check("six notices come in two pages of four, with 'more' true on the first and false on the last", p1.rows.length === 4 && p1.more === true && p2.rows.length === 2 && p2.more === false, JSON.stringify({ a: p1.rows.length, am: p1.more, b: p2.rows.length, bm: p2.more }));
      h.check("newest first, each exactly once", bodies.join("|") === ["for Ann 1", "for Ann 2", "for Ann 3", "for Ann 4", "for Ann 5", "for Ann 6"].join("|"), bodies.join("|"));
      const again = await page(ann, "notifications", "profile_id", 0, 4);
      h.check("asking again gives the same page", JSON.stringify(again.rows.map((r) => r.id)) === JSON.stringify(p1.rows.map((r) => r.id)));

      // what must never come out
      const all = JSON.stringify([profile, weights, sent, p1, p2]);
      h.check("nothing about Bo is in it", !all.includes("Bo wrote this") && !all.includes("for Bo") && !/"weight":"?222(\.0+)?"?[,}]/.test(all)); // Bo's weight is 222: looked for as a weight, because a bare "222" turns up now and then inside a random id
      const posts = await page(ann, "posts", "author_id");
      h.check("her posts are hers only", posts.rows.length === 1 && posts.rows[0].body === "Ann wrote this");
      await h.as(ann);
      h.check("a table that is not on the list is refused (no way to read anyone else's data through it)", (await msg(db, `select public.export_my_data_table('push_subscriptions', 'profile_id', 0, 10)`)).includes("not part of the download"));
      h.check("so is a column that is not on the list", (await msg(db, `select public.export_my_data_table('body_weight_logs', 'group_id', 0, 10)`)).includes("not part of the download"));
      h.check("and an attempt to slip a statement in with the name", (await msg(db, `select public.export_my_data_table('body_weight_logs; drop table public.posts', 'athlete_id', 0, 10)`)).includes("not part of the download"));
      await h.asSuper();
      h.check("the posts table is still there", (await db.query(`select count(*)::int as n from public.posts where author_id = any($1::uuid[])`, [[ann, bo]])).rows[0].n === 2);

      await h.as(coach);
      const coachWeights = (await db.query(`select public.export_my_data_table('body_weight_logs', 'athlete_id', 0, 10) as d`)).rows[0].d;
      h.check("a coach's download holds the coach's own rows only, not the clients' weight logs", coachWeights.rows.length === 0);

      await h.as(bo);
      const boReq = (await db.query(`select public.export_my_data_table('training_partner_requests', 'to_athlete_id', 0, 10) as d`)).rows[0].d;
      h.check("the person who was sent the request sees it in their own download", boReq.rows.length === 1);

      await h.as(null);
      h.check("signed out, both functions refuse", (await msg(db, `select public.export_my_data_table('profiles', 'id', 0, 10)`)) !== "" && (await msg(db, `select * from public.export_my_data_tables()`)) !== "");
      await h.asSuper();
      const grants = (await db.query(`select has_function_privilege('anon', 'public.export_my_data_table(text, text, integer, integer)', 'execute') as anon, has_function_privilege('authenticated', 'public.export_my_data_table(text, text, integer, integer)', 'execute') as authed`)).rows[0];
      h.check("a signed-out visitor cannot run it; a signed-in person can", grants.anon === false && grants.authed === true, JSON.stringify(grants));
      h.check("the private bucket for large downloads exists and is not public", (await db.query(`select public from storage.buckets where id = 'account-exports'`)).rows[0]?.public === false);
    },
  },
};
