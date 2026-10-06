// 0268: session insert guard, workout-log guard vs the recompute trigger (and live's duplicate trigger), redacted audit rows, service role locked out of
// audit_log. 0269: the small-group session fixes. Run as real roles.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};
const at = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

export default {
  name: "0268 guard fixes and audit redaction, 0269 group session fixes",
  migrations: ["0268", "0269"],
  phases: {
    async "0268"({ db, h, state }) {
      const coach = await h.user("G68 Coach");
      const ann = await h.user("G68 Ann");
      const bo = await h.user("G68 Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "G68 group");
      await h.member(group, ann);
      await h.member(group, bo);
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const w1 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'D1', 1) returning id`, [prog, group])).rows[0].id;
      const w2 = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'D2', 2) returning id`, [prog, group])).rows[0].id;
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 3)`, [ann, group]);
      await h.as(coach);
      const booking = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, at(5), at(5, 1)])).id;
      await h.asSuper();
      const audit = async (table, key) => (await h.asSuper(), await h.rows(`select * from public.audit_log where table_name = $1 and row_key = $2 order by id`, [table, key]));

      // ---- 1. client inserts a session already flagged
      await h.as(ann);
      let r = await tryQ(db, `insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, booking_id) values ($1, $2, $3, true, true, $4) returning id, logged_by_coach, deduct_session_credit, booking_id`, [w1, group, ann, booking]);
      h.check("a client's own new session starts as self-logged: coach-logged and deduct-a-session flags forced off, no booking attached", r.rows?.[0]?.logged_by_coach === false && r.rows[0].deduct_session_credit === false && r.rows[0].booking_id === null, JSON.stringify(r));
      const sid = r.rows?.[0]?.id;
      await h.asSuper();
      h.check("...and the attempt is recorded as a blocked write", (await audit("athlete_sessions", sid)).some((x) => x.action === "blocked_write" && x.changed.logged_by_coach?.new === true));
      await h.as(coach);
      r = await tryQ(db, `insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, booking_id) values ($1, $2, $3, true, true, $4) returning logged_by_coach, deduct_session_credit, booking_id`, [w2, group, ann, booking]);
      h.check("a coach logging for a client can still set all three", r.rows?.[0]?.logged_by_coach === true && r.rows[0].deduct_session_credit === true && r.rows[0].booking_id === booking, JSON.stringify(r));
      await h.as(bo);
      r = await tryQ(db, `insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, is_historical) values (null, $1, $2, 'completed', true) returning is_historical`, [group, bo]);
      h.check("a client can still import their own history (is_historical on insert is left alone)", r.rows?.[0]?.is_historical === true, JSON.stringify(r));
      r = await tryQ(db, `select public.start_workout_session($1, $2, $3, false, null, false, $4, '[]'::jsonb) as id`, [w1, group, bo, booking]);
      h.check("starting a workout through the function still works for a client", !!r.rows?.[0]?.id, JSON.stringify(r));

      // ---- 2. workout_logs guard steps aside for the recompute trigger, and the duplicate trigger is gone
      await h.asSuper();
      const histSess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, is_historical) values (null, $1, $2, 'completed', true) returning id`, [group, ann])).rows[0].id;
      const se = (await db.query(`insert into public.session_exercises (session_id, exercise_name) values ($1, 'Squat') returning id`, [histSess])).rows[0].id;
      const setId = (await db.query(`insert into public.set_logs (session_exercise_id, set_order, weight, reps, status) values ($1, 1, 100, 5, 'completed') returning id`, [se])).rows[0].id;
      const logId = (await db.query(`insert into public.workout_logs (session_id, athlete_id, group_id, total_volume, total_sets_completed) values ($1, $2, $3, 500, 1) returning id`, [histSess, ann, group])).rows[0].id;
      await h.as(ann);
      await tryQ(db, `update public.set_logs set weight = 200 where id = $1`, [setId]);
      await h.asSuper();
      let lg = await h.one(`select total_volume from public.workout_logs where id = $1`, [logId]);
      h.check("a client's edit of an imported session's set updates the workout totals (the recompute trigger is not undone by the guard)", Number(lg.total_volume) === 1000, JSON.stringify(lg));
      await h.as(ann);
      await tryQ(db, `update public.workout_logs set total_volume = 999999 where id = $1`, [logId]);
      await h.asSuper();
      lg = await h.one(`select total_volume from public.workout_logs where id = $1`, [logId]);
      h.check("...while a client's direct rewrite of the total is still refused", Number(lg.total_volume) === 1000);
      const trig = await h.rows(`select tgname from pg_trigger where tgrelid = 'public.set_logs'::regclass and not tgisinternal and tgname like '%recompute_workout_log%'`);
      h.check("live's duplicate recompute trigger is dropped and the original kept", trig.length === 1 && trig[0].tgname === "set_logs_recompute_workout_log", JSON.stringify(trig));

      // ---- 3. audit redaction and service role
      await h.asSuper();
      const msg = (await db.query(`insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'Private coaching note about Ann') returning id`, [group, coach, ann])).rows[0].id;
      const req = (await db.query(`insert into public.training_partner_requests (from_athlete_id, to_athlete_id, message) values ($1, $2, 'my number is 555-0101') returning id`, [bo, ann])).rows[0].id;
      await h.as(ann);
      await tryQ(db, `update public.direct_messages set body = 'secret rewrite text', sender_id = $2 where id = $1`, [msg, bo]);
      await tryQ(db, `update public.training_partner_requests set message = 'another secret text' where id = $1`, [req]);
      const dm = await audit("direct_messages", msg);
      const pr = await audit("training_partner_requests", req);
      const text = JSON.stringify([dm, pr]);
      h.check("a blocked rewrite of a message or partner request is recorded as 'changed' without copying any of the text",
        dm.some((x) => x.changed.body?.changed === true) && pr.some((x) => x.changed.message?.changed === true) && !/secret|Private coaching|555-0101/.test(text), text.slice(0, 300));
      h.check("...and the sender change (not sensitive text) is still recorded", dm.some((x) => !!x.changed.sender_id));
      await h.asService();
      const sel = await tryQ(db, `select count(*)::int as n from public.audit_log`);
      h.check("the service role can still read the audit log", sel.rows?.[0]?.n > 0, JSON.stringify(sel));
      for (const [label, sql] of [["insert", `insert into public.audit_log (table_name, action, actor_role) values ('x', 'insert', 'x')`], ["update", `update public.audit_log set table_name = 'x'`], ["delete", `delete from public.audit_log`], ["truncate", `truncate public.audit_log`]]) {
        const e = await tryQ(db, sql);
        h.check(`the service role cannot ${label} audit_log (permission denied)`, /permission denied/i.test(e.error ?? ""), JSON.stringify(e));
      }
      // the triggers that write it still work for the service role's own changes
      const before = (await h.one(`select count(*)::int as n from public.audit_log`)).n;
      await db.query(`update public.profiles set intake_required = not intake_required where id = $1`, [bo]);
      h.check("an audited change made by the service role is still recorded", (await h.one(`select count(*)::int as n from public.audit_log`)).n === before + 1);
      Object.assign(state, { coach, ann, bo, org, group });
    },

    async "0269"({ db, h, state }) {
      const { coach, ann, bo, group } = state;
      const cy = await h.user("G69 Cy");
      await h.member(group, cy);
      const other = await h.user("G69 Other Coach");
      const otherOrg = await h.org(other);
      await h.group(otherOrg, other, "team", "G69 elsewhere");
      await h.asSuper();
      const otherType = (await db.query(`insert into public.session_types (coach_id, name) values ($1, 'Other coach type') returning id`, [other])).rows[0].id;
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 0), ($3, $2, 4) on conflict (athlete_id, group_id) do update set balance = excluded.balance`, [bo, group, cy]);
      const bal = async (a) => { await h.asSuper(); return (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [a, group]))?.balance; };

      await h.as(coach);
      let r = await tryQ(db, `select public.create_group_session($1, 'Typed', $2, $3, 2, $4) as id`, [group, at(20), at(20, 1), otherType]);
      h.check("a class cannot use another coach's session type", /not yours/.test(r.error ?? ""), JSON.stringify(r));
      const cls = (await h.one(`select public.create_group_session($1, 'Boot camp', $2, $3, 1) as id`, [group, at(21), at(21, 1)])).id;
      const anchor = (await h.one(`select anchor_booking_id as a from public.group_sessions where id = $1`, [cls])).a;

      // ---- the anchor is protected
      r = await tryQ(db, `select public.cancel_booking_and_refund_credit($1)`, [anchor]);
      h.check("the class's hidden booking cannot be cancelled through the ordinary booking function", /held by a group session/.test(r.error ?? ""), JSON.stringify(r));
      r = await tryQ(db, `select * from public.reschedule_booking($1, $2, $3)`, [anchor, at(22), at(22, 1)]);
      h.check("...nor moved", /held by a group session/.test(r.error ?? ""), JSON.stringify(r));
      r = await tryQ(db, `update public.bookings set status = 'cancelled' where id = $1`, [anchor]);
      h.check("...nor changed by a direct update", /held by a group session/.test(r.error ?? ""), JSON.stringify(r));
      await h.asSuper();
      r = await tryQ(db, `insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at) values ($1, $2, $3, $4, $5)`, [coach, ann, group, at(21, 0.25), at(21, 0.75)]);
      h.check("a new booking that overlaps a scheduled class is refused inside the database (the race the app-level check cannot close)", /already taken/.test(r.error ?? ""), JSON.stringify(r));
      await h.as(coach);
      const solo = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, ann, group, at(23), at(23, 1)])).id;
      r = await tryQ(db, `select public.create_group_session($1, 'Clash', $2, $3, 3) as id`, [group, at(23, 0.5), at(23, 1.5)]);
      h.check("a class that overlaps an existing booking is refused", /already taken/.test(r.error ?? ""), JSON.stringify(r));

      // ---- waiting list: charged without a floor, coach-added not charged, not after the start
      await h.as(cy);
      await db.query(`select public.join_group_session($1, $2)`, [cls, cy]);
      h.check("a client joins a one-spot class and is charged", (await bal(cy)) === 3);
      await h.as(bo);
      h.check("a client with no sessions joins the waiting list (full class)", (await h.one(`select public.join_group_session($1, $2) as r`, [cls, bo])).r === "waitlisted");
      await h.as(cy);
      const moved = (await h.one(`select public.leave_group_session($1, $2) as p`, [cls, cy])).p;
      h.check("when the spot opens, the person with no sessions left is moved in and becomes owed (-1), as the rules say", moved[0] === bo && (await bal(bo)) === -1, JSON.stringify({ moved, bal: await bal(bo) }));
      await h.asSuper();
      h.check("...recorded as a session taken", (await h.one(`select credit_taken from public.group_session_attendees where group_session_id = $1 and athlete_id = $2`, [cls, bo])).credit_taken === true);

      await h.as(coach);
      const cls2 = (await h.one(`select public.create_group_session($1, 'Second', $2, $3, 1) as id`, [group, at(24), at(24, 1)])).id;
      await h.as(cy);
      await db.query(`select public.join_group_session($1, $2)`, [cls2, cy]);
      await h.as(coach);
      await db.query(`select public.join_group_session($1, $2)`, [cls2, ann]);
      await h.asSuper();
      h.check("a person the coach added to a full class waits uncharged", (await h.one(`select status, added_by_coach from public.group_session_attendees where group_session_id = $1 and athlete_id = $2`, [cls2, ann])).status === "waitlisted");
      const annBefore = await bal(ann);
      await h.as(cy);
      await db.query(`select public.leave_group_session($1, $2)`, [cls2, cy]);
      h.check("...and when moved in is still not charged (the coach's adds are charged when marked attended)", (await bal(ann)) === annBefore);

      // not after the class started
      await h.asSuper();
      await db.query(`update public.group_sessions set start_at = now() - interval '1 hour', end_at = now() + interval '1 hour' where id = $1`, [cls]);
      await h.as(coach);
      await db.query(`select public.join_group_session($1, $2)`, [cls2, cy]).catch(() => {});
      await h.asSuper();
      const cls3 = (await db.query(`select id from public.group_sessions where id = $1`, [cls2])).rows[0].id;
      await db.query(`update public.group_session_attendees set status = 'waitlisted' where group_session_id = $1 and athlete_id = $2`, [cls, cy]).catch(() => {});
      await h.as(coach);
      const mv = (await h.one(`select public.set_group_session_capacity($1, 3) as p`, [cls])).p;
      h.check("nobody is moved off the waiting list into a class that has already started", mv.length === 0, JSON.stringify(mv));

      // ---- credits in a second group with the same coach
      await h.asSuper();
      const group2 = await h.group(state.org, coach, "team", "G69 second group");
      const dee = await h.user("G69 Dee");
      await h.member(group, dee);
      await h.member(group2, dee);
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 0), ($1, $3, 3)`, [dee, group, group2]);
      await h.as(coach);
      const cls4 = (await h.one(`select public.create_group_session($1, 'Fourth', $2, $3, 4) as id`, [group, at(30), at(30, 1)])).id;
      await h.as(dee);
      r = await tryQ(db, `select public.join_group_session($1, $2) as r`, [cls4, dee]);
      await h.asSuper();
      const g2 = (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [dee, group2])).balance;
      h.check("a client whose older group has no sessions but whose second group does is not told 'no credits': the second group is charged", r.rows?.[0]?.r === "joined" && g2 === 2, JSON.stringify({ r, g2 }));

      // ---- cancelling the class still works (the anchor is freed)
      await h.as(coach);
      r = await tryQ(db, `select public.cancel_group_session($1) as a`, [cls4]);
      await h.asSuper();
      const st = (await h.one(`select b.status from public.bookings b join public.group_sessions s on s.anchor_booking_id = b.id where s.id = $1`, [cls4])).status;
      h.check("cancelling the class through its own function still frees the held time", !r.error && st === "cancelled", JSON.stringify({ r, st }));
    },
  },
};
