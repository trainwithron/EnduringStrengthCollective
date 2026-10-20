// 0428 FIX 3 item 4: logging settles the booking once, no-show Charge / Waive, a late move is ONE session, the walk-in. No visit ever takes two sessions.
// Every scenario uses its own client, so one scenario's bookings can never be matched by another's workout.
export default {
  name: "0428 logging settles the booking once; no-show Charge or Waive; a late move is one session; the walk-in",
  migrations: ["0428"],
  phases: {
    async "0428"({ db, h }) {
      const coach = await h.user("F3 Coach");
      const coach2 = await h.user("F3 Other Coach");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "F3 group");
      await h.member(g, coach2, "coach");
      await h.asSuper();
      await db.query(`update public.profiles set timezone = 'America/Los_Angeles' where id = $1`, [coach]);
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'F3', $2) returning id`, [g, coach])).rows[0].id;

      let n = 0;
      const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
      const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
      const client = async (name) => {
        const id = await h.user("F3 " + name);
        await h.member(g, id);
        await h.asSuper();
        await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 10)`, [id, g]);
        return id;
      };
      const bal = async (who) => (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [who, g])).balance;
      const bk = async (id) => h.one(`select * from public.bookings where id = $1`, [id]);
      const booking = async (who, start, { mins = 60, credit = "unsettled", by = coach } = {}) => {
        await h.asSuper();
        const id = (await db.query(
          `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, credit_state, booked_via) values ($1, $2, $3, $4::timestamptz, $4::timestamptz + make_interval(mins => $5), $6, 'coach') returning id`,
          [by, who, g, start, mins, credit]
        )).rows[0].id;
        // A session paid when it was booked took its session then (as book_session does for a client).
        if (credit === "prepaid") await db.query(`select public.apply_session_credit_change($1, $2, -1, 'booked', 'Booked', $3, $4)`, [who, g, id, who]);
        return id;
      };
      // A workout the coach logs for this client, started at `startedAt`, finished now; returns the session and what finishing it took.
      const log = async (who, startedAt, { bookingId = null, deduct = false, by = coach } = {}) => {
        await h.asSuper();
        n++;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id`, [prog, g, "W" + n, n])).rows[0].id;
        const s = (await db.query(
          `insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, started_at, booking_id, deduct_session_credit) values ($1, $2, $3, true, $4, $5, $6) returning id`,
          [w, g, who, startedAt, bookingId, deduct]
        )).rows[0].id;
        await h.as(by);
        const r = (await h.rows(`select credit_consumed from public.complete_workout_session($1)`, [s]))[0];
        await h.asSuper();
        return { s, consumed: r.credit_consumed, linked: (await h.one(`select booking_id from public.athlete_sessions where id = $1`, [s])).booking_id };
      };
      const rpc = async (who, sql, params) => {
        await h.as(who);
        const r = await h.one(sql, params);
        await h.asSuper();
        return r;
      };

      // ---- logging settles the session on the calendar ONCE ----
      const a = await client("Ann");
      const ab = await booking(a, "2026-09-01T17:00:00Z"); // 10:00 AM in Los Angeles
      const al = await log(a, "2026-09-01T17:05:00Z");
      h.check("log with an unsettled same-day booking: 1 session, the booking is linked and marked happened",
        (await bal(a)) === 9 && al.consumed === true && al.linked === ab && (await bk(ab)).credit_state === "settled" && (await bk(ab)).attended_at !== null, `balance ${await bal(a)}`);
      await rpc(coach, `select * from public.complete_workout_session($1)`, [al.s]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [ab]);
      h.check("...finishing again or tapping Yes afterwards takes nothing more", (await bal(a)) === 9);

      const b = await client("Bo");
      const bb = await booking(b, "2026-09-02T17:00:00Z");
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [bb]);
      const bl = await log(b, "2026-09-02T17:10:00Z");
      h.check("marked happened (Did it happen? Yes) and then logged: still exactly 1, and the workout is linked to it (no walk-in prompt)",
        (await bal(b)) === 9 && bl.consumed === false && bl.linked === bb, `balance ${await bal(b)}`);
      const bl2 = await log(b, "2026-09-02T22:00:00Z");
      h.check("...a second workout the same day is not linked to that already-logged session (it is offered as a walk-in)", bl2.linked === null && (await bal(b)) === 9);

      const c = await client("Cy");
      const cb = await booking(c, "2026-09-03T17:00:00Z", { credit: "prepaid" });
      const cl = await log(c, "2026-09-03T16:50:00Z");
      h.check("a session paid when it was booked: logging takes nothing more and marks it happened",
        (await bal(c)) === 9 && cl.consumed === false && cl.linked === cb && (await bk(cb)).attended_at !== null);

      const d = await client("Di");
      const dl = await log(d, "2026-09-04T17:00:00Z", { deduct: true });
      h.check("no booking, started with the old 'Use 1 session credit' box ticked (before the app update): its one session, as before",
        (await bal(d)) === 9 && dl.consumed === true && dl.linked === null);
      const dl0 = await log(d, "2026-09-04T19:00:00Z");
      h.check("no booking and no box: nothing taken, nothing linked", (await bal(d)) === 9 && dl0.consumed === false && dl0.linked === null);
      await booking(d, "2026-09-05T17:00:00Z");
      const dl2 = await log(d, "2026-09-04T18:00:00Z");
      h.check("a booking on a different day is not matched", dl2.linked === null && (await bal(d)) === 9);

      const e = await client("Ed");
      const eb = await booking(e, "2026-09-06T17:00:00Z");
      const el = await log(e, "2026-09-06T23:00:00Z", { bookingId: eb });
      const el2 = await log(e, "2026-09-06T23:30:00Z", { bookingId: eb });
      h.check("linked at Start twice (two workouts on one session): 1 session in all", (await bal(e)) === 9 && el.consumed === true && el2.consumed === false);

      // ---- the coach's day, not UTC's ----
      const f = await client("Flo");
      const fb = await booking(f, "2026-09-16T01:30:00Z"); // 6:30 PM on Sept 15 in Los Angeles (Sept 16 in UTC)
      const fl = await log(f, "2026-09-15T16:00:00Z"); // 9:00 AM on Sept 15 in Los Angeles
      h.check("a 6:30 PM Los Angeles session (01:30 UTC the next day) matches a workout that morning", fl.linked === fb && (await bal(f)) === 9);
      const f2 = await client("Flo Two");
      await booking(f2, "2026-09-16T01:30:00Z", { by: coach2 });
      const fl2 = await log(f2, "2026-09-16T08:00:00Z", { by: coach2 }); // 1:00 AM on Sept 16 in Los Angeles; coach2 has no zone (New York): Sept 16 4:00 AM vs the session at Sept 15 9:30 PM
      h.check("...and a workout on the next local day does not", fl2.linked === null && (await bal(f2)) === 10);

      const gg = await client("Gus");
      const g1 = await booking(gg, "2026-09-07T16:00:00Z", { by: coach2 });
      const g2 = await booking(gg, "2026-09-07T22:00:00Z");
      const gl = await log(gg, "2026-09-07T16:05:00Z");
      h.check("two sessions that day: the logging coach's own is settled", gl.linked === g2 && (await bk(g1)).attended_at === null && (await bal(gg)) === 9);
      const gl2 = await log(gg, "2026-09-07T16:10:00Z", { by: coach2 });
      h.check("...and the other coach logging later settles theirs, once", gl2.linked === g1 && (await bal(gg)) === 8);

      // ---- no-show: Charge or Waive ----
      const k = await client("Kai");
      const kb = await booking(k, "2026-09-08T17:00:00Z");
      const kc = await rpc(coach, `select public.resolve_no_show($1, true) as v`, [kb]);
      h.check("no-show Charge on an unpaid session: 1 session, recorded as a no-show", (await bal(k)) === 9 && kc.v === true && (await bk(kb)).no_show === true && (await bk(kb)).credit_state === "settled");
      await h.expectErrorAs(coach, "...marking it a no-show again is refused", `select public.resolve_no_show($1, true)`, [kb], /already a no-show/);
      const kl = await log(k, "2026-09-08T17:30:00Z");
      h.check("...a workout that day does not match a no-show", kl.linked === null && (await bal(k)) === 9);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [kb]);
      h.check("no-show Charge then Undo: net 0, an ordinary unpaid session again", (await bal(k)) === 10 && (await bk(kb)).no_show === false && (await bk(kb)).credit_state === "unsettled");
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [kb]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [kb]);
      h.check("...Charge and Undo again: still net 0", (await bal(k)) === 10);

      const m = await client("Mo");
      const mb = await booking(m, "2026-09-09T17:00:00Z");
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [mb]);
      const mrow = await h.one(`select kind, amount from public.session_credit_ledger where booking_id = $1`, [mb]);
      h.check("no-show Waive on an unpaid session: nothing taken, a 0 'waived' entry, waived", (await bal(m)) === 10 && mrow.kind === "waived" && mrow.amount === 0 && (await bk(mb)).credit_state === "waived");
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [mb]);
      h.check("...Undo: an ordinary unpaid session again", (await bk(mb)).credit_state === "unsettled" && (await bal(m)) === 10);

      const p = await client("Pia");
      const pb = await booking(p, "2026-09-10T17:00:00Z", { credit: "prepaid" });
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [pb]);
      h.check("no-show Charge on a session paid at booking: nothing more", (await bal(p)) === 9 && (await bk(pb)).credit_state === "prepaid");
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [pb]);
      const pb2 = await booking(p, "2026-09-11T17:00:00Z", { credit: "prepaid" });
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [pb2]);
      h.check("no-show Waive on a session paid at booking: its session comes back", (await bal(p)) === 9 && (await bk(pb2)).credit_state === "waived");
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [pb2]);
      h.check("...Undo: paid for again, as when it was booked", (await bal(p)) === 8 && (await bk(pb2)).credit_state === "prepaid");
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [pb2]);
      h.check("...then marked happened: still exactly 1 for it", (await bal(p)) === 8);

      // The reviewer's sequences: undos in any order never take two sessions for one visit.
      const pr = await client("Pru");
      const prb = await booking(pr, "2026-09-24T17:00:00Z", { credit: "prepaid" });
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [prb]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [prb]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [prb]);
      await rpc(coach, `select public.undo_booking_attended($1) as v`, [prb]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [prb]);
      h.check("paid at booking: no-show Waive, Undo, happened, Undo, happened again: exactly 1", (await bal(pr)) === 9, `balance ${await bal(pr)}`);
      const prb2 = await booking(pr, "2026-09-25T17:00:00Z", { credit: "prepaid" });
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [prb2]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [prb2]);
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [prb2]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [prb2]);
      const prl = await log(pr, "2026-09-25T17:05:00Z");
      h.check("paid at booking: no-show Waive, Undo, no-show Charge, Undo, then logged: exactly 1", (await bal(pr)) === 8 && prl.linked === prb2, `balance ${await bal(pr)}`);
      const prb3 = await booking(pr, "2026-09-26T17:00:00Z");
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [prb3]);
      const marked = await rpc(coach, `select public.mark_booking_attended($1) as v`, [prb3]);
      h.check("a no-show is not marked happened on top (undo the no-show first)", marked.v === false && (await bk(prb3)).attended_at === null);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [prb3]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [prb3]);
      h.check("...Undo the no-show, then happened: exactly 1 for it", (await bal(pr)) === 7 && (await bk(prb3)).credit_state === "settled");
      const prb4 = await booking(pr, "2026-09-27T17:00:00Z");
      await rpc(coach, `select public.waive_booking($1, 'holiday') as v`, [prb4]);
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [prb4]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [prb4]);
      h.check("waived by the coach, then no-show Charge, then Undo: waived again, nothing used", (await bal(pr)) === 7 && (await bk(prb4)).credit_state === "waived");

      const q = await client("Quinn");
      const qb = await booking(q, "2026-09-12T17:00:00Z");
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [qb]);
      await h.expectErrorAs(coach, "a no-show on a session marked happened is refused", `select public.resolve_no_show($1, true)`, [qb], /marked as happened/);
      await h.expectErrorAs(coach, "...through the old switch too", `select public.set_booking_no_show($1, true)`, [qb], /marked as happened/);
      h.check("...and nothing changed", (await bal(q)) === 9 && (await bk(qb)).no_show === false);
      const qf = await booking(q, new Date(Date.now() + 5 * 86400000).toISOString());
      await h.expectErrorAs(coach, "a no-show on a future session is refused", `select public.resolve_no_show($1, true)`, [qf], /not started/);
      const qp = await booking(q, "2026-09-13T17:00:00Z");
      await h.expectErrorAs(q, "a client cannot mark their own session a no-show", `select public.resolve_no_show($1, false)`, [qp], /not authorized/);
      await h.expectErrorAs(coach2, "...nor can another coach of the group (only the session's own coach or an owner)", `select public.resolve_no_show($1, true)`, [qp], /not authorized/);
      await h.expectErrorAs(q, "...nor undo one", `select public.set_booking_no_show($1, false)`, [qp], /not authorized/);
      await rpc(coach, `select public.set_booking_no_show($1, true) as v`, [qp]);
      h.check("the old switch set to no-show is a waived no-show", (await bk(qp)).no_show === true && (await bk(qp)).credit_state === "waived" && (await bal(q)) === 9);
      const qpp = await booking(q, "2026-09-13T20:00:00Z", { credit: "prepaid" });
      await rpc(coach, `select public.set_booking_no_show($1, true) as v`, [qpp]);
      h.check("...on a session paid at booking (the old screen, until the app update): it stays taken, as the old switch did", (await bk(qpp)).no_show === true && (await bk(qpp)).credit_state === "prepaid" && (await bal(q)) === 8);

      // ---- the client finishes a workout the coach started (Send to client) ----
      const cf = await client("Cora");
      const cfb = await booking(cf, "2026-09-26T19:00:00Z");
      await h.asSuper();
      n++;
      const cfw = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id`, [prog, g, "W" + n, n])).rows[0].id;
      const cfs = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, started_at) values ($1, $2, $3, true, true, '2026-09-26T19:05:00Z') returning id`, [cfw, g, cf])).rows[0].id;
      await rpc(cf, `select * from public.complete_workout_session($1)`, [cfs]);
      h.check("the client finishes a coach-started workout with the old box ticked and a session that day: exactly 1, and the link is kept",
        (await bal(cf)) === 9 && (await h.one(`select booking_id from public.athlete_sessions where id = $1`, [cfs])).booking_id === cfb && (await bk(cfb)).attended_at !== null, `balance ${await bal(cf)}`);
      n++;
      const cfw2 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id`, [prog, g, "W" + n, n])).rows[0].id;
      const cfs2 = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, started_at) values ($1, $2, $3, true, true, '2026-09-27T19:05:00Z') returning id`, [cfw2, g, cf])).rows[0].id;
      await rpc(cf, `select * from public.complete_workout_session($1)`, [cfs2]);
      h.check("...with the box ticked and no session that day: its one (the old box), once", (await bal(cf)) === 8);
      await h.as(cf);
      await db.query(`update public.athlete_sessions set started_at = '2026-01-01T00:00:00Z', import_batch_id = gen_random_uuid(), completed_at = '2026-01-01T01:00:00Z', booking_id = null where id = $1`, [cfs]);
      await h.asSuper();
      const cfrow = await h.one(`select started_at, import_batch_id, completed_at, booking_id from public.athlete_sessions where id = $1`, [cfs]);
      h.check("a client cannot move a coach-logged workout's start, mark it imported, change its finish or drop its link",
        new Date(cfrow.started_at).toISOString() === "2026-09-26T19:05:00.000Z" && cfrow.import_batch_id === null && new Date(cfrow.completed_at).toISOString() !== "2026-01-01T01:00:00.000Z" && cfrow.booking_id === cfb, JSON.stringify(cfrow));
      await h.asSuper();
      n++;
      const cfw3 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id`, [prog, g, "W" + n, n])).rows[0].id;
      const cfb3 = await booking(cf, "2026-09-28T19:00:00Z");
      const cfs3 = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, started_at) values ($1, $2, $3, true, '2026-09-28T19:05:00Z') returning id`, [cfw3, g, cf])).rows[0].id;
      await h.as(cf);
      await db.query(`update public.athlete_sessions set started_at = '2026-09-29T19:05:00Z', import_batch_id = gen_random_uuid() where id = $1`, [cfs3]);
      await rpc(cf, `select * from public.complete_workout_session($1)`, [cfs3]);
      h.check("...so moving it to another day (or marking it imported) before finishing does not dodge its session: exactly 1", (await bal(cf)) === 7 && (await bk(cfb3)).attended_at !== null);

      // ---- a cancel gives back only what the booking took ----
      await h.asSuper();
      const fr = await client("Fritz");
      const frb = (await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, credit_state, booked_via) values ($1, $2, $3, now() + interval '20 days', now() + interval '20 days 1 hour', 'prepaid', 'coach') returning id`, [coach, fr, g])).rows[0].id;
      await rpc(coach, `select public.cancel_booking_and_refund_credit($1) as v`, [frb]);
      h.check("cancelling a 'prepaid' booking that never took a session gives nothing back (no free session)", (await bal(fr)) === 10);
      const frb2 = await booking(fr, future(21), { credit: "prepaid" });
      await rpc(coach, `select public.cancel_booking_and_refund_credit($1) as v`, [frb2]);
      h.check("...one that did take a session gives it back", (await bal(fr)) === 10);

      // ---- a late MOVE is ONE session ----
      const flag = async (id, kind = "reschedule") => {
        await h.asSuper();
        await db.query(`update public.bookings set late_change_kind = $2, late_charge_state = 'flagged' where id = $1`, [id, kind]);
      };
      const r = await client("Rae");
      const rb = await booking(r, "2026-09-14T17:00:00Z");
      await flag(rb);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [rb]);
      const rrow = await h.one(`select kind, amount from public.session_credit_ledger where booking_id = $1`, [rb]);
      h.check("late move Charged: 1 session, written as a session used ('delivered')", (await bal(r)) === 9 && rrow.kind === "delivered" && rrow.amount === -1 && (await bk(rb)).credit_state === "settled");
      const rl = await log(r, "2026-09-14T17:05:00Z");
      h.check("late move Charged then the moved session logged: exactly 1 in all", (await bal(r)) === 9 && rl.linked === rb && rl.consumed === false);
      await rpc(coach, `select public.undo_booking_attended($1) as v`, [rb]);
      h.check("...Undo attended gives back only what attendance took (nothing); the late charge stays", (await bal(r)) === 9 && (await bk(rb)).credit_state === "settled" && (await bk(rb)).attended_at === null);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [rb]);
      h.check("...marked happened again: still exactly 1", (await bal(r)) === 9);

      const r2 = await client("Rex");
      const r2b = await booking(r2, "2026-09-28T17:00:00Z");
      await flag(r2b);
      await log(r2, "2026-09-28T17:05:00Z");
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [r2b]);
      h.check("logged, then the late move Charged: still exactly 1", (await bal(r2)) === 9);
      await rpc(coach, `select public.undo_booking_attended($1) as v`, [r2b]);
      h.check("...Undo attended: the late charge is the one session, nothing comes back", (await bal(r2)) === 9 && (await bk(r2b)).credit_state === "settled");
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [r2b]);
      h.check("...then a no-show Charge: nothing more", (await bal(r2)) === 9);
      const r2c = await booking(r2, "2026-09-29T17:00:00Z");
      await flag(r2c);
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [r2c]);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [r2c]);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [r2c]);
      h.check("no-show Charge, late move Charge, Undo the no-show: exactly 1 (the late charge)", (await bal(r2)) === 8 && (await bk(r2c)).credit_state === "settled");
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [r2c]);
      h.check("...a no-show Charge again: nothing more", (await bal(r2)) === 8);

      const s = await client("Sol");
      const sb = await booking(s, "2026-09-15T17:00:00Z", { credit: "prepaid" });
      await flag(sb);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [sb]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [sb]);
      h.check("late move Charged on a session paid at booking, then it happened: exactly 1 in all", (await bal(s)) === 9);
      const sb2 = await booking(s, "2026-09-17T17:00:00Z");
      await flag(sb2);
      await rpc(coach, `select public.resolve_late_change($1, false) as v`, [sb2]);
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [sb2]);
      h.check("late move Waived, then it happened: 1 for the session", (await bal(s)) === 8);

      const t = await client("Tess");
      const tb = await booking(t, "2026-09-18T17:00:00Z");
      await flag(tb);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [tb]);
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [tb]);
      h.check("late move Charged, then a no-show Waived: no refund (the late charge is the one session)", (await bal(t)) === 9 && (await bk(tb)).no_show === true);
      await rpc(coach, `select public.set_booking_no_show($1, false) as v`, [tb]);
      h.check("...Undo the no-show: the late charge still stands", (await bal(t)) === 9 && (await bk(tb)).credit_state === "settled");
      const tb2 = await booking(t, "2026-09-19T17:00:00Z");
      await flag(tb2);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [tb2]);
      await rpc(coach, `select public.resolve_no_show($1, true) as v`, [tb2]);
      h.check("late move Charged, then a no-show Charged: nothing more", (await bal(t)) === 8);
      const tb3 = await booking(t, "2026-09-20T17:00:00Z");
      await flag(tb3);
      await rpc(coach, `select public.resolve_no_show($1, false) as v`, [tb3]);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [tb3]);
      h.check("a no-show Waived while the late move waits, then the late move Charged: 1 (the session that never happened)", (await bal(t)) === 7);

      // Late cancel Charge: one session, written as used.
      const u = await client("Uma");
      const ub = await booking(u, "2026-09-21T17:00:00Z");
      await h.asSuper();
      await db.query(`update public.bookings set status = 'cancelled' where id = $1`, [ub]);
      await flag(ub, "cancel");
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [ub]);
      const urow = await h.one(`select kind, amount from public.session_credit_ledger where booking_id = $1`, [ub]);
      h.check("late cancel Charged: 1 session ('delivered')", (await bal(u)) === 9 && urow.kind === "delivered" && urow.amount === -1);

      // A charged late move, then cancelled: by the coach = the session back; by the client = nothing back, not flagged again.
      const v = await client("Vic");
      const vb = await booking(v, future(10));
      await flag(vb);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb]);
      await rpc(coach, `select public.cancel_booking_and_refund_credit($1) as v`, [vb]);
      h.check("coach cancels a late-move-Charged session: the late charge comes back (net 0)", (await bal(v)) === 10 && (await bk(vb)).status === "cancelled");
      const vb2 = await booking(v, future(11));
      await flag(vb2);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb2]);
      await rpc(v, `select public.cancel_booking_and_refund_credit($1) as v`, [vb2]);
      const vrow = await bk(vb2);
      h.check("client cancels a late-move-Charged session: nothing back, not flagged again", (await bal(v)) === 9 && vrow.status === "cancelled" && vrow.late_change_kind === "reschedule" && vrow.late_charge_state === "charged");
      const vb3 = await booking(v, future(12), { credit: "prepaid" });
      await flag(vb3);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb3]);
      await rpc(v, `select public.cancel_booking_and_refund_credit($1) as v`, [vb3]);
      h.check("...the same for a session paid at booking (one session in all)", (await bal(v)) === 8);
      const vb5 = await booking(v, future(14));
      await flag(vb5);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb5]);
      await flag(vb5);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb5]);
      h.check("a charged late move moved late again and Charged again: nothing more", (await bal(v)) === 7);
      await flag(vb5);
      await rpc(coach, `select public.resolve_late_change($1, false) as v`, [vb5]);
      await rpc(v, `select public.cancel_booking_and_refund_credit($1) as v`, [vb5]);
      h.check("...moved late a third time and Waived, then the client cancels: nothing back", (await bal(v)) === 7);
      const vb6 = await booking(v, future(15));
      await flag(vb6);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [vb6]);
      await flag(vb6);
      await rpc(v, `select public.cancel_booking_and_refund_credit($1) as v`, [vb6]);
      h.check("a charged late move moved late again, and the client cancels while it waits: nothing back, not flagged again", (await bal(v)) === 6 && (await bk(vb6)).late_change_kind === "reschedule" && (await bk(vb6)).late_charge_state === "charged");
      const cc = await client("Cal");
      const ccb = await booking(cc, future(16));
      await flag(ccb);
      await rpc(coach, `select public.cancel_booking_and_refund_credit($1) as v`, [ccb]);
      await h.expectErrorAs(coach, "the coach cancels a session whose late move is waiting: nothing left to decide (Charge refused)", `select public.resolve_late_change($1, true)`, [ccb], /not waiting for a decision/);
      h.check("...and nothing taken", (await bal(cc)) === 10 && (await bk(ccb)).late_charge_state === "waived");
      const ccb2 = await booking(cc, future(17), { credit: "prepaid" });
      await flag(ccb2);
      await rpc(cc, `select public.cancel_booking_and_refund_credit($1) as v`, [ccb2]);
      h.check("a client cancels in time a paid session whose late move is waiting: their session back for now", (await bal(cc)) === 10);
      await rpc(coach, `select public.resolve_late_change($1, true) as v`, [ccb2]);
      h.check("...then the coach Charges the late move: exactly 1 (the moved session never happened), and the cancelled booking is not 'settled'", (await bal(cc)) === 9 && (await bk(ccb2)).credit_state === "prepaid" && (await bk(ccb2)).status === "cancelled");
      const vb4 = await booking(v, future(13), { credit: "prepaid" });
      await rpc(v, `select public.cancel_booking_and_refund_credit($1) as v`, [vb4]);
      h.check("a client cancelling in time with no late change still gets their session back", (await bal(v)) === 6);

      // ---- the walk-in (offered right after the workout, so these are within the last day) ----
      const finish = async (sessionId, at) => { await h.asSuper(); await db.query(`update public.athlete_sessions set completed_at = $2 where id = $1`, [sessionId, at]); };
      const w = await client("Wes");
      const wStart = ago(23 * 60);
      const wl = await log(w, wStart);
      await finish(wl.s, ago(23 * 60 - 35));
      h.check("a workout with no booking: nothing taken, nothing linked (the app asks)", wl.linked === null && (await bal(w)) === 10);
      const wid = (await rpc(coach, `select public.create_walk_in_booking($1) as id`, [wl.s])).id;
      const wb = await bk(wid);
      h.check("Yes: 1 session, a booking on the coach's calendar for at least a session's length (60 minutes), linked",
        (await bal(w)) === 9 && wb.coach_id === coach && wb.credit_state === "settled" && wb.attended_at !== null
          && new Date(wb.start_at).toISOString() === wStart && new Date(wb.end_at).getTime() - new Date(wStart).getTime() === 60 * 60000
          && (await h.one(`select booking_id from public.athlete_sessions where id = $1`, [wl.s])).booking_id === wid,
        JSON.stringify({ start: wb.start_at, end: wb.end_at, bal: await bal(w) }));
      const wid2 = (await rpc(coach, `select public.create_walk_in_booking($1) as id`, [wl.s])).id;
      h.check("...Yes again (a double tap): the same booking, nothing more", wid2 === wid && (await bal(w)) === 9 && (await h.one(`select count(*)::int as n from public.bookings where athlete_id = $1`, [w])).n === 1);

      const x = await client("Xan");
      const xl = await log(x, ago(21 * 60));
      const xEnd = ago(21 * 60 - 90);
      await finish(xl.s, xEnd);
      for (let d = 0; d < 7; d++) await db.query(`insert into public.coach_availability_windows (coach_id, weekday, start_time, end_time, session_minutes) values ($1, $2, '00:00', '23:59:59', 45)`, [coach, d]);
      const xid = (await rpc(coach, `select public.create_walk_in_booking($1) as id`, [xl.s])).id;
      h.check("a workout longer than a session: the booking runs to its finish", new Date((await bk(xid)).end_at).toISOString() === xEnd && (await bal(x)) === 9);

      const y = await client("Yas");
      const yStart = ago(18 * 60);
      const yl = await log(y, yStart);
      await finish(yl.s, ago(18 * 60 - 20));
      const yid = (await rpc(coach, `select public.create_walk_in_booking($1) as id`, [yl.s])).id;
      h.check("the coach's session length for that time (45 minutes) is used", new Date((await bk(yid)).end_at).getTime() - new Date(yStart).getTime() === 45 * 60000 && (await bal(y)) === 9);

      const z = await client("Zed");
      const zl = await log(z, ago(23 * 60 - 30));
      await finish(zl.s, ago(23 * 60 - 50));
      await h.expectErrorAs(coach, "a walk-in over another session on the calendar is refused", `select public.create_walk_in_booking($1)`, [zl.s], /overlaps another session/);
      h.check("...and nothing is taken or made", (await bal(z)) === 10 && (await h.one(`select count(*)::int as n from public.bookings where athlete_id = $1`, [z])).n === 0);
      await h.expectErrorAs(z, "a client cannot make a walk-in", `select public.create_walk_in_booking($1)`, [zl.s], /not authorized/);

      const zz = await client("Zoe");
      const zzStart = ago(16 * 60);
      const zzl = await log(zz, zzStart);
      const zzb = await booking(zz, zzStart); // appears after the workout was finished
      const zzid = (await rpc(coach, `select public.create_walk_in_booking($1) as id`, [zzl.s])).id;
      h.check("a session on the calendar that day after all: that one is settled, no second booking", zzid === zzb && (await bal(zz)) === 9 && (await h.one(`select count(*)::int as n from public.bookings where athlete_id = $1`, [zz])).n === 1);

      const cleo = await client("Cleo");
      await h.asSuper();
      const gsId = (await db.query(`insert into public.group_sessions (coach_id, title, start_at, end_at, status, group_id, kind, capacity) values ($1, 'Bootcamp', $2, $3, 'scheduled', $4, 'class', 10) returning id`, [coach2, ago(14 * 60), ago(13 * 60), g])).rows[0].id;
      await db.query(`insert into public.group_session_attendees (group_session_id, athlete_id, group_id, status) values ($1, $2, $3, 'joined')`, [gsId, cleo, g]);
      const cll = await log(cleo, ago(14 * 60 - 5));
      await finish(cll.s, ago(13 * 60 + 10));
      await h.expectErrorAs(coach, "a walk-in is refused when the client was in a class at that time", `select public.create_walk_in_booking($1)`, [cll.s], /already on the calendar/);
      h.check("...and nothing is taken", (await bal(cleo)) === 10);
      const lk = await client("Lou");
      const lkStart = ago(12 * 60);
      const lkb = await booking(lk, lkStart);
      const lk1 = await log(lk, lkStart);
      const lk2 = await log(lk, ago(11 * 60));
      await finish(lk2.s, ago(11 * 60 - 20));
      await h.expectErrorAs(coach, "a walk-in is refused when that day's session is already linked to another workout", `select public.create_walk_in_booking($1)`, [lk2.s], /already on the calendar/);
      h.check("...exactly 1 for the day", lk1.linked === lkb && lk2.linked === null && (await bal(lk)) === 9);

      const old = await client("Old");
      const oldl = await log(old, "2026-09-01T17:00:00Z");
      await finish(oldl.s, "2026-09-01T17:40:00Z");
      await h.expectErrorAs(coach, "an old workout cannot be added as a walk-in", `select public.create_walk_in_booking($1)`, [oldl.s], /cannot be added as a walk-in/);
      const dd = await log(old, ago(10 * 60), { deduct: true });
      await h.expectErrorAs(coach, "...nor one that already used a session the old way (the Use 1 session credit box)", `select public.create_walk_in_booking($1)`, [dd.s], /cannot be added as a walk-in/);
      h.check("...and nothing more was taken for either (the box took its one)", (await bal(old)) === 9);

      // ---- a morning workout never uses the evening session (the coach's day is mid-morning here: a zone where it is about 10 AM now) ----
      const utcHour = new Date().getUTCHours();
      const shift = ((utcHour - 10 + 36) % 24) - 12; // Etc/GMT+N is N hours behind UTC
      await h.asSuper();
      await db.query(`update public.profiles set timezone = $2 where id = $1`, [coach, "Etc/GMT" + (shift >= 0 ? "+" : "-") + Math.abs(shift)]);
      const am = await client("Ami");
      const amB = await booking(am, ago(40));
      const pmB = await booking(am, new Date(Date.now() + 5 * 3600000).toISOString());
      await rpc(coach, `select public.mark_booking_attended($1) as v`, [amB]);
      const aml = await log(am, ago(30));
      h.check("marked happened at 9:20, then the 9:30 workout logged: linked to that session, the 3 PM one untouched, exactly 1",
        aml.linked === amB && (await bk(pmB)).attended_at === null && (await bk(pmB)).credit_state === "unsettled" && (await bal(am)) === 9, JSON.stringify({ linked: aml.linked, amB, pmB, bal: await bal(am) }));
      const am2 = await client("Ami Two");
      const am2B = await booking(am2, new Date(Date.now() + 6.5 * 3600000).toISOString());
      const am2l = await log(am2, ago(30));
      h.check("a morning walk-in does not use that client's 3 PM session", am2l.linked === null && (await bk(am2B)).attended_at === null && (await bal(am2)) === 10);
      const soon = await client("Ami Three");
      const soonB = await booking(soon, new Date(Date.now() + 30 * 60000).toISOString());
      const soonl = await log(soon, ago(20));
      h.check("a session starting within the hour after the finish (logged early) still counts", soonl.linked === soonB && (await bal(soon)) === 9);
      await h.asSuper();
      await db.query(`update public.profiles set timezone = 'America/Los_Angeles' where id = $1`, [coach]);

      // ---- an imported workout (a team sheet, imported history) is never matched to the calendar ----
      const im = await client("Ima");
      const imb = await booking(im, "2026-09-30T17:00:00Z");
      await h.asSuper();
      n++;
      const imw = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, $3, $4) returning id`, [prog, g, "W" + n, n])).rows[0].id;
      const ims = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, is_historical, started_at) values ($1, $2, $3, true, true, '2026-09-30T17:00:00Z') returning id`, [imw, g, im])).rows[0].id;
      await rpc(coach, `select * from public.complete_workout_session($1)`, [ims]);
      h.check("an imported workout on a booked day takes nothing and links nothing", (await bal(im)) === 10 && (await h.one(`select booking_id from public.athlete_sessions where id = $1`, [ims])).booking_id === null && (await bk(imb)).attended_at === null);

      // ---- who can call what ----
      await h.as(coach);
      for (const fn of ["match_booking_for_session", "booking_taken", "booking_late_move_charged"]) {
        await h.expectError(`${fn} is not callable by a signed-in person`, () => db.query(`select public.${fn}($1)`, [h.uuid(1)]), /permission denied/);
      }
      await h.expectError("booking_put_back is not callable by a signed-in person", () => db.query(`select public.booking_put_back($1, 'x')`, [h.uuid(1)]), /permission denied/);
      await h.expectError("settle_booking_internal is still not callable by a signed-in person", () => db.query(`select public.settle_booking_internal($1, 1, 'x', $1)`, [h.uuid(1)]), /permission denied/);
      await h.asSuper();
    },
  },
};
