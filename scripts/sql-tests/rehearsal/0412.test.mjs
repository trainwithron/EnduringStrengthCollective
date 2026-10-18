// 0412: "Download my data" collects every row the signed-in person can read that points at them, from every table that has such a column, and nothing about anyone else.
// Run AS the person, so row security still applies. Secrets and sign-in tokens are never in it.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0412 Download my data (everything)",
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
      await db.query(`insert into public.notifications (profile_id, type, body, link_path) values ($1, 'booking_request', 'for Ann', '/'), ($2, 'booking_request', 'for Bo', '/')`, [ann, bo]);
      await db.query(`insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth_key) values ($1, 'https://push.example/ann', 'SECRETKEY-P256', 'SECRETKEY-AUTH')`, [ann]);

      await h.as(ann);
      const out = (await db.query(`select public.export_my_data() as d`)).rows[0].d;
      const text = JSON.stringify(out);
      h.check("her profile is in it", out["profiles.id"]?.rows?.[0]?.id === ann);
      h.check("her weight log is in it", (out["body_weight_logs.athlete_id"]?.rows ?? []).length === 1 && Number(out["body_weight_logs.athlete_id"].rows[0].weight) === 161);
      h.check("her post and her notice are in it, found without anyone listing those tables", (out["posts.author_id"]?.rows ?? []).length === 1 && (out["notifications.profile_id"]?.rows ?? []).length === 1);
      h.check("nothing about Bo is in it", !text.includes("Bo wrote this") && !text.includes("for Bo") && !text.includes("222"));
      h.check("her push keys are not in it", !text.includes("SECRETKEY") && !out["push_subscriptions.profile_id"]);
      h.check("nothing is marked cut when it is small", Object.values(out).every((v) => v.truncated === false));

      await h.as(coach);
      const mine = (await db.query(`select public.export_my_data() as d`)).rows[0].d;
      h.check("a coach's download holds the coach's own rows only, not the clients' weight logs", !mine["body_weight_logs.athlete_id"] && !JSON.stringify(mine).includes("Ann wrote this"));

      await h.as(null);
      h.check("signed out, it refuses", (await msg(db, `select public.export_my_data()`)) !== "");
      await h.asSuper();
      const grants = (await db.query(`select has_function_privilege('anon', 'public.export_my_data()', 'execute') as anon, has_function_privilege('authenticated', 'public.export_my_data()', 'execute') as authed`)).rows[0];
      h.check("a signed-out visitor cannot run it; a signed-in person can", grants.anon === false && grants.authed === true, JSON.stringify(grants));
    },
  },
};
