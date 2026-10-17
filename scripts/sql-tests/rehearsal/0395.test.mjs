// 0395: quiet hours and private lock screens are the person's own choices; a notice has a pushed_at; payments get a notification type.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0395 Push quality",
  migrations: ["0395"],
  phases: {
    async "0395"({ db, h }) {
      const me = await h.user("PQ Person");
      const other = await h.user("PQ Other");

      await h.as(me);
      let r = await tryQ(db, `update public.profiles set quiet_hours_start = 22, quiet_hours_end = 6, generic_push_text = true where id = $1`, [me]);
      h.check("a person sets their own quiet hours and private lock screen" + (r.error ? ": " + r.error : ""), !r.error);
      r = await tryQ(db, `update public.profiles set quiet_hours_start = 24 where id = $1`, [me]);
      h.check("an hour past 23 is refused", !!r.error);
      r = await tryQ(db, `update public.profiles set quiet_hours_end = -1 where id = $1`, [me]);
      h.check("a negative hour is refused", !!r.error);
      await h.asSuper();
      const row = (await db.query(`select quiet_hours_start, quiet_hours_end, generic_push_text from public.profiles where id = $1`, [me])).rows[0];
      h.check("the choices were saved", row.quiet_hours_start === 22 && row.quiet_hours_end === 6 && row.generic_push_text === true);
      const def = (await db.query(`select quiet_hours_start, generic_push_text from public.profiles where id = $1`, [other])).rows[0];
      h.check("everyone else starts with no quiet hours and real text", def.quiet_hours_start === null && def.generic_push_text === false);

      await h.as(other);
      r = await tryQ(db, `update public.profiles set quiet_hours_start = 1 where id = $1`, [me]);
      await h.asSuper();
      h.check("nobody can change another person's quiet hours", (await db.query(`select quiet_hours_start from public.profiles where id = $1`, [me])).rows[0].quiet_hours_start === 22);

      // ---- notices
      const ok = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, 'payment_received', 'x', '/x') returning pushed_at`, [me]);
      h.check("a payment notice is accepted" + (ok.error ? ": " + ok.error : ""), !ok.error);
      h.check("a new notice has no pushed_at (the job sends it)", ok.rows?.[0]?.pushed_at === null);
      const bad = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, 'nonsense', 'x', '/x')`, [me]);
      h.check("an unknown notice type is still refused", !!bad.error);
      const types = await Promise.all(["booking_request", "late_change", "schedule_request", "request_decision", "organization_invite", "space_invite", "org_announcement"].map((t) => tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, $2, 'x', '/x')`, [me, t])));
      h.check("the types the push job and the invite code write are all accepted", types.every((x) => !x.error), JSON.stringify(types.filter((x) => x.error)));
      const idx = (await db.query(`select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_unpushed_idx'`)).rows.length;
      h.check("the job finds waiting notices through an index", idx === 1);
    },
  },
};
