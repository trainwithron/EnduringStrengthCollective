// 0248 (session credit settlement) on the live-equivalent schema, as real signed-in roles (so row security applies): a coach's booking takes
// nothing, a client's booking takes one at booking, attending settles once, undo gives back only what was taken, waive charges nothing, the
// balance has no floor, a client cannot change their own balance, and a long series books without credits and keeps its local time across the
// clock change. (settlement.test.mjs runs the same rules on a smaller database; the coach-logged completion path is in the 0236 test.)
const hr = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

export default {
  name: "0248 session credit settlement",
  migrations: ["0248"],
  phases: {
    async "0248"({ db, h }) {
      const coach = await h.user("Settle Coach");
      const ann = await h.user("Settle Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "one_on_one", "Settle 1-on-1");
      await h.member(group, ann);
      await h.asSuper();
      await db.query(`update public.profiles set timezone = 'America/New_York' where id in ($1, $2)`, [coach, ann]);
      const balance = async () => { await h.asSuper(); return (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [ann, group]))?.balance; };
      const ledger = async (kind) => { await h.asSuper(); return (await h.one(`select count(*)::int as n from public.session_credit_ledger where athlete_id = $1 and kind = $2`, [ann, kind])).n; };

      await h.as(coach);
      await db.query(`select public.assign_session_credits($1, $2, 3, 'start')`, [ann, group]);
      h.check("assigning sessions sets the balance", (await balance()) === 3);

      await h.as(coach);
      const b1 = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, hr(48), hr(49)])).id;
      await h.asSuper();
      h.check("a coach's booking takes nothing and starts unsettled", (await balance()) === 3 && (await h.one(`select credit_state from public.bookings where id = $1`, [b1])).credit_state === "unsettled");
      await h.as(ann);
      const b2 = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, hr(72), hr(73)])).id;
      await h.asSuper();
      h.check("a client's own booking takes one at booking and is prepaid", (await balance()) === 2 && (await h.one(`select credit_state from public.bookings where id = $1`, [b2])).credit_state === "prepaid");

      await h.as(coach);
      await db.query(`select public.mark_booking_attended($1)`, [b1]);
      h.check("marking an unsettled session attended takes one and settles it", (await balance()) === 1 && (await h.asSuper(), (await h.one(`select credit_state from public.bookings where id = $1`, [b1])).credit_state === "settled"));
      await h.as(coach);
      await db.query(`select public.mark_booking_attended($1)`, [b1]);
      h.check("marking it again does not charge twice", (await balance()) === 1);
      await h.as(coach);
      await db.query(`select public.undo_booking_attended($1)`, [b1]);
      await db.query(`select public.undo_booking_attended($1)`, [b1]);
      h.check("undo gives back only what was taken, once", (await balance()) === 2);
      await h.as(coach);
      await db.query(`select public.mark_booking_attended($1)`, [b2]);
      h.check("attending a prepaid session is not a second charge", (await balance()) === 2);
      await h.as(coach);
      await db.query(`select public.waive_booking($1, 'holiday')`, [b1]);
      h.check("waiving an unsettled session charges nothing", (await balance()) === 2 && (await h.asSuper(), (await h.one(`select credit_state from public.bookings where id = $1`, [b1])).credit_state === "waived"));

      await h.as(coach);
      const b3 = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, hr(96), hr(97)])).id;
      const before = await balance();
      await h.as(coach);
      await db.query(`select public.cancel_booking_and_refund_credit($1)`, [b3]);
      h.check("cancelling a coach booking that took nothing refunds nothing", (await balance()) === before);
      await h.as(ann);
      const b4 = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, hr(120), hr(121)])).id;
      const mid = await balance();
      await h.as(coach);
      await db.query(`select public.cancel_booking_and_refund_credit($1)`, [b4]);
      h.check("cancelling a prepaid booking as the coach refunds the one that was taken", (await balance()) === mid + 1);

      await h.as(coach);
      const bz = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, hr(150), hr(151)])).id;
      await db.query(`select public.set_session_balance($1, $2, 0, 'zero it')`, [ann, group]);
      await db.query(`select public.mark_booking_attended($1)`, [bz]);
      h.check("attending with no sessions left takes the balance below zero (no floor)", (await balance()) === -1);

      await h.as(ann);
      await h.expectError("a client cannot adjust their own balance", () => db.query(`select public.adjust_session_credits($1, $2, 5)`, [ann, group]), /not authorized/);
      await h.expectError("a client cannot mark their own session attended", () => db.query(`select public.mark_booking_attended($1)`, [b2]), /not authorized|not allowed/i);

      await h.as(coach);
      const bal = await balance();
      await h.as(coach);
      const series = (await h.rows(`select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 20)`, [coach, ann, group, "2026-10-20T10:00:00Z"]))[0];
      h.check("a 20-week series books all 20 with no credits taken", series.booked_count === 20 && series.failed_count === 0 && (await balance()) === bal, JSON.stringify(series));
      await h.asSuper();
      const hours = await h.rows(`select distinct to_char(start_at at time zone 'America/New_York', 'HH24:MI') as t from public.bookings where recurring_series_id = $1`, [series.series_id]);
      h.check("every session stays at 6:00 New York time across the clock change", hours.length === 1 && hours[0].t === "06:00", JSON.stringify(hours));
      await h.as(coach);
      await h.expectError("a series over 52 weeks is refused", () => db.query(`select * from public.create_recurring_booking_series($1, $2, $3, $4, 60, 53)`, [coach, ann, group, "2027-06-01T10:00:00Z"]), /between 1 and 52/);
      h.check("every change is in the ledger", (await ledger("assigned")) >= 1 && (await ledger("booked")) >= 2 && (await ledger("delivered")) >= 1);
    },
  },
};
