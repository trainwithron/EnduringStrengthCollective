// 0291 (Release F): a booking, a waiting-list place or a weekly schedule must name a coach who coaches that group; a client cannot cancel or move a session that has
// started or been marked attended (a coach is never refused, and a future cancel works as before).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const SQL_TIME = (hh, mm, plusDays) => `(date_trunc('day', now() at time zone 'UTC') + interval '${plusDays} days' + interval '${hh} hours ${mm} minutes') at time zone 'UTC'`;

export default {
  name: "0291 Release F booking closures",
  migrations: ["0291"],
  phases: {
    async "0290"({ db, h }) {
      const coach = await h.user("G1 Coach");
      const other = await h.user("G1 Other Coach");
      const ann = await h.user("G1 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "G1 group");
      await h.member(group, ann);
      await h.org(other);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5) on conflict (athlete_id, group_id) do update set balance = 5`, [ann, group]);
      await h.as(coach);
      const r = await tryQ(db, `select public.book_session($1, $2, $3, ${SQL_TIME(10, 0, 30)}, ${SQL_TIME(10, 55, 30)}) as id`, [other, ann, group]);
      await h.asSuper();
      h.check("baseline: before 0291 a coach can book onto another coach's calendar through book_session", !r.error && !!r.rows?.[0]?.id, JSON.stringify(r));
    },

    async "0291"({ db, h }) {
      const coach = await h.user("G2 Coach");
      const other = await h.user("G2 Other Coach");
      const ann = await h.user("G2 Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "G2 group");
      await h.member(group, ann);
      await h.org(other);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 5) on conflict (athlete_id, group_id) do update set balance = 5`, [ann, group]);
      await db.query(`insert into public.coach_booking_policies (coach_id, booking_mode) values ($1, 'free') on conflict (coach_id) do update set booking_mode = 'free'`, [coach]);

      // coach must coach the group: book_session, waitlist, weekly series
      await h.as(coach);
      const bad = await tryQ(db, `select public.book_session($1, $2, $3, ${SQL_TIME(10, 0, 40)}, ${SQL_TIME(10, 55, 40)}) as id`, [other, ann, group]);
      const good = await tryQ(db, `select public.book_session($1, $2, $3, ${SQL_TIME(10, 0, 40)}, ${SQL_TIME(10, 55, 40)}) as id`, [coach, ann, group]);
      const wl = await tryQ(db, `select public.join_booking_waitlist($1, $2, $3, ${SQL_TIME(10, 0, 40)}, ${SQL_TIME(10, 55, 40)}) as id`, [other, ann, group]);
      const series = await tryQ(db, `select * from public.create_recurring_booking_series($1, $2, $3, ${SQL_TIME(9, 0, 41)}, 55, 3)`, [other, ann, group]);
      await h.asSuper();
      h.check("book_session refuses a coach who does not coach the group", /that coach does not coach this group/.test(bad.error ?? ""), JSON.stringify(bad));
      h.check("book_session still books the group's own coach", !good.error && !!good.rows?.[0]?.id, JSON.stringify(good));
      h.check("join_booking_waitlist refuses a coach who does not coach the group", /that coach does not coach this group/.test(wl.error ?? ""), JSON.stringify(wl));
      h.check("a weekly series refuses such a coach, and leaves no empty series behind", /that coach does not coach this group/.test(series.error ?? "") && (await h.one(`select count(*)::int as n from public.recurring_booking_series where coach_id = $1`, [other])).n === 0, JSON.stringify(series));
      const own = await tryQ(db, `select 1`, []);
      await h.as(coach);
      const okSeries = await tryQ(db, `select * from public.create_recurring_booking_series($1, $2, $3, ${SQL_TIME(9, 0, 41)}, 55, 3)`, [coach, ann, group]);
      await h.asSuper();
      h.check("a weekly series for the group's own coach still books", !okSeries.error && okSeries.rows?.[0]?.booked_count === 3, JSON.stringify(okSeries));

      // client cannot cancel or move a started session
      const pastId = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, now() - interval '3 hours', now() - interval '2 hours', 'confirmed', 'prepaid') returning id`, [coach, ann, group])).rows[0].id;
      const futId = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state) values ($1, $2, $3, ${SQL_TIME(14, 0, 50)}, ${SQL_TIME(14, 55, 50)}, 'confirmed', 'prepaid') returning id`, [coach, ann, group])).rows[0].id;
      await h.as(ann);
      const cancelPast = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [pastId]);
      const movePast = await tryQ(db, `select public.reschedule_booking($1, ${SQL_TIME(15, 0, 52)}, ${SQL_TIME(15, 55, 52)})`, [pastId]);
      const moveFuture = await tryQ(db, `select public.reschedule_booking($1, ${SQL_TIME(16, 0, 51)}, ${SQL_TIME(16, 55, 51)})`, [futId]);
      const cancelFuture = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [futId]);
      await h.asSuper();
      h.check("a client cannot cancel a session that has already started", /already started/.test(cancelPast.error ?? ""), JSON.stringify(cancelPast));
      h.check("a client cannot move a session that has already started", /already started/.test(movePast.error ?? ""), JSON.stringify(movePast));
      h.check("a client can still move a future session (booking mode free)", !moveFuture.error, JSON.stringify(moveFuture));
      h.check("a client can still cancel a future session", !cancelFuture.error, JSON.stringify(cancelFuture));
      const stillConfirmed = (await h.one(`select status from public.bookings where id = $1`, [pastId])).status;
      h.check("the refused cancel left the started session confirmed", stillConfirmed === "confirmed", stillConfirmed);

      await db.query(`update public.bookings set attended_at = now() - interval '1 hour' where id = $1`, [pastId]);
      await h.as(coach);
      const coachCancel = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [pastId]);
      await h.asSuper();
      h.check("the coach can still cancel a started session", !coachCancel.error, JSON.stringify(coachCancel));

      // the nightly expiry takes off an amount, in one locked step, server only
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 6) on conflict (athlete_id, group_id) do update set balance = 6`, [ann, group]);
      await h.as(coach);
      const asCoach = await tryQ(db, `select public.expire_session_credit_balance($1, $2, 2, 6)`, [ann, group]);
      await h.asService();
      const stale = await tryQ(db, `select public.expire_session_credit_balance($1, $2, 2, 5) as ok`, [ann, group]);
      const tooMuch = await tryQ(db, `select public.expire_session_credit_balance($1, $2, 9, 6) as ok`, [ann, group]);
      const zero = await tryQ(db, `select public.expire_session_credit_balance($1, $2, 0, 6) as ok`, [ann, group]);
      const expGood = await tryQ(db, `select public.expire_session_credit_balance($1, $2, 2, 6) as ok`, [ann, group]);
      await h.asSuper();
      const expAfter = await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group]);
      const ledger = await h.one(`select count(*)::int as n, coalesce(sum(amount), 0)::int as total from public.session_credit_ledger where athlete_id = $1 and group_id = $2 and kind = 'expired'`, [ann, group]);
      const rec = await h.one(`select count(*)::int as n, coalesce(sum(credits_expired), 0)::int as total from public.session_credit_expirations where athlete_id = $1 and group_id = $2`, [ann, group]);
      h.check("a signed-in coach cannot run the expiry function", /permission denied/i.test(asCoach.error ?? ""), JSON.stringify(asCoach));
      h.check("it refuses when the balance is not what the job read, when asked for more than the balance, and for zero", stale.rows?.[0]?.ok === false && tooMuch.rows?.[0]?.ok === false && zero.rows?.[0]?.ok === false, JSON.stringify({ stale, tooMuch, zero }));
      h.check("it takes exactly the amount asked: 6 -> 4, with one ledger row of -2 and one expiry record of 2", expGood.rows?.[0]?.ok === true && expAfter.balance === 4 && ledger.n === 1 && ledger.total === -2 && rec.n === 1 && rec.total === 2, JSON.stringify({ expGood, expAfter, ledger, rec }));
    },
  },
};
