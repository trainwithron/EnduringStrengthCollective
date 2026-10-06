// 0278: the coach's booking mode. 'free' = clients book on their own, 'request' = clients ask and the coach confirms, 'coach_schedules' = the coach
// schedules everyone. Existing coaches start as 'coach_schedules'. A client's direct booking, weekly schedule and waiting-list join follow the mode;
// a coach acting for a client and the server's own routines never do. Before 0278 any client with a credit could book themselves.
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
const book = (db, s, day) => tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [s.coach, s.ann, s.group, at(day), at(day, 1)]);
const setMode = async (db, h, s, mode) => {
  await h.asSuper();
  await db.query(`insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, $2) on conflict (coach_id) do update set booking_mode = $2`, [s.coach, mode]);
};

export default {
  name: "0278 the coach's booking mode (free, request, coach schedules)",
  migrations: ["0278"],
  phases: {
    async "0277"({ db, h }) {
      const s = await setup(db, h, "B0");
      await h.as(s.ann);
      const r = await book(db, s, 5);
      await h.asSuper();
      h.check("baseline: today a client with a credit can book their own session (the behaviour 0278 puts behind the booking mode)", !r.error && !!r.rows?.[0]?.id, JSON.stringify(r));
    },

    async "0278"({ db, h }) {
      const s = await setup(db, h, "B1");
      const msg = (r, re) => re.test(r.error ?? "");

      // default: the coach schedules everyone
      const mode0 = await h.one(`select public.coach_booking_mode($1) as m`, [s.coach]);
      h.check("a coach with no policy row is 'coach_schedules'", mode0.m === "coach_schedules", JSON.stringify(mode0));
      await h.as(s.ann);
      const off = await book(db, s, 6);
      const weekly = await tryQ(db, `select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 3)`, [s.coach, s.ann, s.group, at(12)]);
      const wait = await tryQ(db, `select public.join_booking_waitlist($1, $2, $3, $4, $5)`, [s.coach, s.ann, s.group, at(7), at(7, 1)]);
      await h.asSuper();
      h.check("by default a client cannot book, start a weekly schedule or join a waiting list", msg(off, /your coach schedules your sessions/) && msg(weekly, /your coach schedules/) && msg(wait, /your coach schedules/) && (await h.one(`select balance from public.session_credits where athlete_id = $1`, [s.ann])).balance === 5, JSON.stringify({ off, weekly, wait }));
      const col = await h.one(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'booking_mode'`);
      h.check("the column defaults to 'coach_schedules'", /coach_schedules/.test(col.column_default), JSON.stringify(col));

      // a coach scheduling a client is never refused
      await h.as(s.coach);
      const byCoach = await book(db, s, 7);
      const coachWeekly = await tryQ(db, `select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 2)`, [s.coach, s.ann, s.group, at(20)]);
      await h.asSuper();
      h.check("a coach can book a client and start a weekly schedule in any mode", !byCoach.error && !coachWeekly.error && coachWeekly.rows?.[0]?.booked_count === 2, JSON.stringify({ byCoach, coachWeekly }));
      await h.asService();
      const bySvc = await tryQ(db, `select public.book_session($1, $2, $3, $4, $5) as id`, [s.coach, s.ann, s.group, at(8), at(8, 1)]);
      await h.asSuper();
      h.check("the server's own routines can still book", !bySvc.error && !!bySvc.rows?.[0]?.id, JSON.stringify(bySvc));

      // request mode: the client is told to send a request
      await setMode(db, h, s, "request");
      await h.as(s.ann);
      const req = await book(db, s, 9);
      const reqWeekly = await tryQ(db, `select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 3)`, [s.coach, s.ann, s.group, at(30)]);
      await h.asSuper();
      h.check("in request mode a direct booking or weekly schedule is refused with 'send a request'", msg(req, /confirms new sessions: send a request/) && msg(reqWeekly, /send a request/), JSON.stringify({ req, reqWeekly }));

      // free mode: as before
      await setMode(db, h, s, "free");
      await h.as(s.ann);
      const free = await book(db, s, 10);
      await h.asSuper();
      h.check("in free mode a client books themselves (and uses a credit) as before", !free.error && !!free.rows?.[0]?.id, JSON.stringify(free));

      // who can change the mode
      await h.as(s.other);
      await tryQ(db, `insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, 'free') on conflict (coach_id) do update set booking_mode = 'free'`, [s.other]);
      await h.as(s.ann);
      const selfSet = await tryQ(db, `insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, 'free') on conflict (coach_id) do update set booking_mode = 'free'`, [s.coach]);
      await h.asSuper();
      await setMode(db, h, s, "coach_schedules");
      await h.as(s.ann);
      const stillOff = await book(db, s, 11);
      await h.asSuper();
      h.check("another coach's setting does not apply, and a client cannot change their coach's mode", !!stillOff.error, JSON.stringify({ selfSet, stillOff }));
      const bad = await tryQ(db, `update public.coach_booking_policies set booking_mode = 'anything' where coach_id = $1`, [s.coach]);
      h.check("an unknown mode is rejected by the database", !!bad.error, JSON.stringify(bad));
      const priv = await h.one(`select
          has_function_privilege('anon', 'public.coach_booking_mode(uuid)', 'execute') as a,
          has_function_privilege('authenticated', 'public.coach_booking_mode(uuid)', 'execute') as b,
          has_function_privilege('authenticated', 'public.assert_client_may_book_directly(uuid, uuid, uuid)', 'execute') as c,
          has_function_privilege('authenticated', 'public.coach_time_zone(uuid)', 'execute') as d,
          has_function_privilege('service_role', 'public.coach_booking_mode(uuid)', 'execute') as e`);
      h.check("the internal helpers are closed to signed-out and signed-in users (one coach cannot ask about another), open to the server", priv.a === false && priv.b === false && priv.c === false && priv.d === false && priv.e === true, JSON.stringify(priv));
      await h.asSuper();
      const tzNone = await h.one(`select public.coach_time_zone($1) as z`, [s.coach]);
      await db.query(`update public.profiles set timezone = 'America/Los_Angeles' where id = $1`, [s.coach]);
      const tzSet = await h.one(`select public.coach_time_zone($1) as z`, [s.coach]);
      await db.query(`update public.profiles set timezone = 'Not/AZone' where id = $1`, [s.coach]);
      const tzBad = await h.one(`select public.coach_time_zone($1) as z`, [s.coach]);
      h.check("coach_time_zone: the profile zone, or null when none is set or it is not a real zone", tzNone.z === null && tzSet.z === "America/Los_Angeles" && tzBad.z === null, JSON.stringify({ tzNone, tzSet, tzBad }));
    },
  },
};
