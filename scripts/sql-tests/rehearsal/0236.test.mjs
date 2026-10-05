// 0236: completing a workout is idempotent (one log per session), a completed workout can't be edited by the athlete, starting a workout is one
// atomic, resumable function. Also proves 0236's text patch of complete_workout_session still applies on top of 0248's patch of the same function
// (they are applied in that order), and that a coach-logged session tied to a booking still settles exactly once.
export default {
  name: "0236 workout session integrity (and 0248's patch of complete_workout_session)",
  migrations: ["0236", "0248"],
  phases: {
    async "0236"({ db, h, state }) {
      const coach = await h.user("Coach");
      const ann = await h.user("Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team");
      await h.member(group, ann);
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id`, [group, coach])).rows[0].id;
      const workout = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id`, [prog, group])).rows[0].id;
      const exercises = JSON.stringify([
        { exercise_name: "Squat", exercise_order: 1, tracked_fields: ["reps", "weight"], sets: [{ set_order: 1, weight: 100, reps: 5 }, { set_order: 2, weight: 100, reps: 5 }] },
        { exercise_name: "Row", exercise_order: 2, sets: [{ set_order: 1, weight: 50, reps: 8 }] },
      ]);
      const start = async () => (await h.one(`select public.start_workout_session($1, $2, $3, false, null, false, null, $4::jsonb) as id`, [workout, group, ann, exercises])).id;

      // ---- atomic, resumable start
      await h.as(ann);
      const s1 = await start();
      const counts = async (s) => (await h.one(`select (select count(*) from public.session_exercises where session_id = $1)::int as ex, (select count(*) from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = $1)::int as sets`, [s]));
      let c = await counts(s1);
      h.check("starting a workout creates the session with all its exercises and sets in one call", c.ex === 2 && c.sets === 3, JSON.stringify(c));
      const s1b = await start();
      c = await counts(s1);
      h.check("starting again (Resume) reuses the in-progress session and adds nothing", s1b === s1 && c.ex === 2 && c.sets === 3);
      await h.asSuper();
      await db.query(`delete from public.session_exercises where session_id = $1`, [s1]);
      await h.as(ann);
      const s1c = await start();
      c = await counts(s1);
      h.check("a session left empty by a dropped connection is filled in on the next start", s1c === s1 && c.ex === 2 && c.sets === 3);
      await h.asSuper();
      await h.as(null);
      await h.expectError("a signed-out caller cannot start a workout", () => db.query(`select public.start_workout_session($1, $2, $3, false, null, false, null, $4::jsonb)`, [workout, group, ann, exercises]), /permission denied|not authorized|violates row-level/i);

      // ---- complete once, however many times the button is tapped
      await h.as(ann);
      await db.query(`update public.set_logs set status = 'completed' where session_exercise_id in (select id from public.session_exercises where session_id = $1)`, [s1]);
      const first = (await h.rows(`select * from public.complete_workout_session($1)`, [s1]))[0];
      const second = (await h.rows(`select * from public.complete_workout_session($1)`, [s1]))[0];
      await h.asSuper();
      const logs = (await h.one(`select count(*)::int as n from public.workout_logs where session_id = $1`, [s1])).n;
      h.check("completing a workout produces one log", logs === 1);
      h.check("completing it again hands back the same log and changes nothing", first && second && first.workout_log_id === second.workout_log_id && Number(second.total_volume) === Number(first.total_volume));
      h.check("the log's totals are right (100x5 + 100x5 + 50x8)", Number(first.total_volume) === 1400 && first.total_sets_completed === 3, JSON.stringify(first));
      await h.expectError("a second workout log for the same session is refused by the database", () => db.query(`insert into public.workout_logs (session_id, athlete_id, group_id) values ($1, $2, $3)`, [s1, ann, group]), /duplicate key|unique/i);

      // ---- no athlete edits to a completed workout; the coach can still fix it
      const setId = (await h.one(`select sl.id from public.set_logs sl join public.session_exercises se on se.id = sl.session_exercise_id where se.session_id = $1 limit 1`, [s1])).id;
      await h.as(ann);
      await h.expectError("the athlete cannot change a set after completing the workout", () => db.query(`update public.set_logs set weight = 999 where id = $1`, [setId]), /already completed/i);
      await h.as(coach);
      await db.query(`update public.set_logs set weight = 105 where id = $1`, [setId]);
      await h.asSuper();
      h.check("the coach can still correct a completed workout", Number((await h.one(`select weight from public.set_logs where id = $1`, [setId])).weight) === 105);

      // ---- a coach-logged session on the calendar settles its booking once, through the patched function
      const bo = await h.user("Bo");
      await h.member(group, bo);
      await h.asSuper();
      await db.query(`insert into public.session_credits (athlete_id, group_id, balance) values ($1, $2, 3)`, [bo, group]);
      await h.as(coach);
      const booking = (await h.one(`select public.book_session($1, $2, $3, $4, $5) as id`, [coach, bo, group, new Date(Date.now() + 48 * 3600e3).toISOString(), new Date(Date.now() + 49 * 3600e3).toISOString()])).id;
      await h.asSuper();
      const sess = (await db.query(`insert into public.athlete_sessions (workout_id, group_id, athlete_id, logged_by_coach, deduct_session_credit, booking_id) values ($1, $2, $3, true, true, $4) returning id`, [workout, group, bo, booking])).rows[0].id;
      await h.as(coach);
      const r1 = (await h.rows(`select * from public.complete_workout_session($1)`, [sess]))[0];
      const r2 = (await h.rows(`select * from public.complete_workout_session($1)`, [sess]))[0];
      await h.asSuper();
      const bal = (await h.one(`select balance from public.session_credits where athlete_id = $1 and group_id = $2`, [bo, group])).balance;
      const bk = await h.one(`select credit_state from public.bookings where id = $1`, [booking]);
      h.check("coach-logged workout tied to a booking settles it: one session taken, booking settled", bal === 2 && bk.credit_state === "settled", `balance ${bal}, state ${bk.credit_state}`);
      h.check("tapping Finish twice does not take a second session", r1.workout_log_id === r2.workout_log_id && bal === 2);
      h.check("the log is flagged coach-logged and credit consumed on the first call only", r1.credit_consumed === true && r2.credit_consumed === false, JSON.stringify([r1.credit_consumed, r2.credit_consumed]));
    },
  },
};
