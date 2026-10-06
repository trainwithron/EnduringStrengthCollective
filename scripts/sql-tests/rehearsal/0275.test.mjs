// 0275: cancelling or moving one week of an ongoing weekly schedule marks that week as skipped, so the nightly top-up does not book it back.
// The gap exists on the live schema today (nothing records it); this proves the gap, the fix, and that the server's own routines and fixed-length
// schedules are untouched.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

export default {
  name: "0275 a cancelled or moved week of an ongoing schedule stays skipped",
  migrations: ["0275"],
  phases: {
    // Right before 0275 applies: the state the live database is in.
    async "0274"({ db, h, state }) {
      const coach = await h.user("S Coach");
      const ann = await h.user("S Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "S group");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 10)`, [ann, group]);
      const mk = async (mode) => (await db.query(`insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total, mode) values ($1, $2, $3, 2, '09:00', 60, $4, $5) returning id`, [coach, ann, group, mode === "fixed" ? 4 : null, mode])).rows[0].id;
      const ongoing = await mk("ongoing");
      const fixed = await mk("fixed");
      const book = async (series, startDays) => {
        const id = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, recurring_series_id) values ($1, $2, $3, $4, $5, 'confirmed', 'unsettled', $6) returning id`, [coach, ann, group, at(startDays), at(startDays, 1), series])).rows[0].id;
        return id;
      };
      const o1 = await book(ongoing, 8);
      const o2 = await book(ongoing, 15);
      const o3 = await book(ongoing, 22);
      const f1 = await book(fixed, 9);
      Object.assign(state, { coach, ann, group, ongoing, fixed, o1, o2, o3, f1 });
      await h.as(ann);
      const cancelled = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [o1]);
      await h.asSuper();
      const s = (await h.one(`select cardinality(skipped_starts) as n from public.recurring_booking_series where id = $1`, [ongoing])).n;
      h.check("baseline: a client cancelling one week of an ongoing schedule records nothing, so the top-up would book it back (the gap 0275 closes)", !cancelled.error && s === 0, JSON.stringify({ cancelled, s }));
    },

    async "0275"({ db, h, state }) {
      const { coach, ann, ongoing, fixed, o2, o3, f1 } = state;
      await h.as(ann);
      const c2 = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [o2]);
      await h.asSuper();
      const sk = async (id) => (await h.one(`select cardinality(skipped_starts) as n, (select start_at from public.bookings where id = $2) = any (skipped_starts) as has from public.recurring_booking_series where id = $1`, [id, o2]));
      let r = await sk(ongoing);
      h.check("after 0275 a client cancelling one week of an ongoing schedule marks that week skipped", !c2.error && r.n === 1 && r.has === true, JSON.stringify({ c2, r }));

      // the same booking cancelled again does nothing, and an update that does not cancel does not add
      await h.as(ann);
      await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [o2]);
      await h.asSuper();
      r = await sk(ongoing);
      h.check("it is recorded once", r.n === 1, JSON.stringify(r));

      // moving a session records the week it left
      await h.as(ann);
      const moved = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [o3, at(24), at(24, 1)]);
      await h.asSuper();
      r = await h.one(`select cardinality(skipped_starts) as n from public.recurring_booking_series where id = $1`, [ongoing]);
      h.check("moving one week to another time marks the week it left", !moved.error && r.n === 2, JSON.stringify({ moved, r }));

      // fixed-length schedules are untouched
      await h.as(ann);
      const cf = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [f1]);
      await h.asSuper();
      const fr = await h.one(`select cardinality(skipped_starts) as n from public.recurring_booking_series where id = $1`, [fixed]);
      h.check("cancelling a week of a fixed-length schedule leaves its skipped list alone", !cf.error && fr.n === 0, JSON.stringify({ cf, fr }));

      // the server's own routines are untouched: cancelling as the server records nothing
      await h.asSuper();
      const extra = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, recurring_series_id) values ($1, $2, (select group_id from public.recurring_booking_series where id = $3), $4, $5, 'confirmed', 'unsettled', $3) returning id`, [coach, ann, ongoing, at(30), at(30, 1)])).rows[0].id;
      await h.asService();
      await db.query(`update public.bookings set status = 'cancelled' where id = $1`, [extra]);
      await h.asSuper();
      r = await h.one(`select cardinality(skipped_starts) as n from public.recurring_booking_series where id = $1`, [ongoing]);
      h.check("a cancellation by the server's own routines (pause, end, the series tools) is not added to the skipped list", r.n === 2, JSON.stringify(r));

      // a coach cancelling through the booking function also marks it
      const extra2 = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state, recurring_series_id) values ($1, $2, (select group_id from public.recurring_booking_series where id = $3), $4, $5, 'confirmed', 'unsettled', $3) returning id`, [coach, ann, ongoing, at(37), at(37, 1)])).rows[0].id;
      await h.as(coach);
      const cc = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [extra2]);
      await h.asSuper();
      r = await h.one(`select cardinality(skipped_starts) as n from public.recurring_booking_series where id = $1`, [ongoing]);
      h.check("a coach cancelling a week through the booking function marks it too", !cc.error && r.n === 3, JSON.stringify({ cc, r }));
    },
  },
};
