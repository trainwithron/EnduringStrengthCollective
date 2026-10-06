// 0278: a client can book their own session only when the coach has switched self-booking on (off by default). Before 0278 any client with a
// credit could book themselves (the live behaviour today). Proves the baseline, the default-off refusal, the coach's switch, and that a coach
// booking a client and the server's own jobs are unaffected.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

async function setup(db, h, label) {
  const coach = await h.user(`${label} Coach`);
  const ann = await h.user(`${label} Ann`);
  const other = await h.user(`${label} Other Coach`);
  const org = await h.org(coach);
  const group = await h.group(org, coach, "one_on_one", `${label} group`);
  await h.member(group, ann);
  await h.asSuper();
  await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5)`, [ann, group]);
  return { coach, ann, other, group };
}
const book = (db, s, who, day) =>
  tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [s.coach, s.ann, s.group, at(day), at(day, 1)]);

export default {
  name: "0278 self-booking is a per-coach switch, off by default",
  migrations: ["0278"],
  phases: {
    async "0277"({ db, h }) {
      const s = await setup(db, h, "B0");
      await h.as(s.ann);
      const r = await book(db, s, s.ann, 5);
      await h.asSuper();
      h.check("baseline: today a client with a credit can book their own session with no switch (the behaviour 0278 puts behind a switch)", !r.error && !!r.rows?.[0]?.id, JSON.stringify(r));
    },

    async "0278"({ db, h }) {
      const s = await setup(db, h, "B1");
      // default off
      await h.as(s.ann);
      const off = await book(db, s, s.ann, 6);
      await h.asSuper();
      h.check("with the default (off) a client cannot book themselves, and no credit is used", !!off.error && /your coach schedules your sessions/.test(off.error) && (await h.one(`select balance from public.session_credits where athlete_id = $1`, [s.ann])).balance === 5, JSON.stringify(off));
      const col = await h.one(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'self_booking_enabled'`);
      h.check("the column defaults to false", col.column_default === "false", JSON.stringify(col));

      // the coach can book the client with it off
      await h.as(s.coach);
      const byCoach = await book(db, s, s.coach, 7);
      await h.asSuper();
      h.check("a coach booking a client works with the switch off", !byCoach.error && !!byCoach.rows?.[0]?.id, JSON.stringify(byCoach));

      // the server's own routines are unaffected
      await h.asService();
      const bySvc = await tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [s.coach, s.ann, s.group, at(8), at(8, 1)]);
      await h.asSuper();
      h.check("the server's own routines can still book", !bySvc.error && !!bySvc.rows?.[0]?.id, JSON.stringify(bySvc));

      // a different coach turning it on does not turn it on for this coach
      await h.as(s.other);
      const wrong = await tryQ(db, `insert into public.coach_booking_policies (coach_id, self_booking_enabled) values ($1, true) on conflict (coach_id) do update set self_booking_enabled = true`, [s.other]);
      await h.as(s.ann);
      const stillOff = await book(db, s, s.ann, 9);
      h.check("another coach's switch does not apply to this coach", !wrong.error && !!stillOff.error, JSON.stringify({ wrong, stillOff }));

      // the client cannot turn it on for the coach
      const selfOn = await tryQ(db, `insert into public.coach_booking_policies (coach_id, self_booking_enabled) values ($1, true) on conflict (coach_id) do update set self_booking_enabled = true`, [s.coach]);
      await h.asSuper();
      const flag = await h.one(`select coalesce((select self_booking_enabled from public.coach_booking_policies where coach_id = $1), false) as on`, [s.coach]);
      h.check("a client cannot switch self-booking on for their coach", flag.on === false, JSON.stringify({ selfOn, flag }));

      // the coach switches it on
      await h.as(s.coach);
      const turned = await tryQ(db, `insert into public.coach_booking_policies (coach_id, self_booking_enabled) values ($1, true) on conflict (coach_id) do update set self_booking_enabled = true`, [s.coach]);
      await h.as(s.ann);
      const on = await book(db, s, s.ann, 10);
      await h.asSuper();
      h.check("once the coach switches it on, the client can book (and uses one credit)", !turned.error && !on.error && !!on.rows?.[0]?.id, JSON.stringify({ turned, on }));
    },
  },
};
