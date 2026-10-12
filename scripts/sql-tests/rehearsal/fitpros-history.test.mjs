// FitPros history import: the coach writes backdated history for a client in their group with the same rows the importer uses (a session linked to the program's workout, its exercises
// linked to the program's lines with a note, sets with time, height and distance), as the coach under row security. It makes no workout log and no record, the one-session-per-workout rule
// holds, and deleting the session takes its exercises and sets with it (the undo).
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "FitPros history import writes history only",
  migrations: [],
  phases: {
    async live({ db, h }) {
      const coach = await h.user("FH Coach");
      const stranger = await h.user("FH Other Coach");
      const client = await h.user("FH Client");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "FH team");
      await h.member(group, client);
      const org2 = await h.org(stranger);
      const group2 = await h.group(org2, stranger, "team", "FH other");
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id, is_active) values ($1, 'FH program', $2, $3, true) returning id`, [group, coach, client])).rows[0].id;
      const wk = (await db.query(`insert into public.workouts (program_id, group_id, athlete_id, title, week_number, day_index) values ($1, $2, $3, 'Day 1', 1, 1) returning id`, [prog, group, client])).rows[0].id;
      const line = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, athlete_id, exercise_name, exercise_order, tracked_fields) values ($1, $2, $3, 'Plank', 1, array['time']) returning id`, [wk, group, client])).rows[0].id;
      const logsBefore = (await db.query("select count(*)::int as n from public.workout_logs")).rows[0].n;
      const recordsBefore = (await db.query("select count(*)::int as n from public.exercise_records")).rows[0].n;

      await h.as(coach);
      const session = await db.query(
        `insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, is_historical, started_at, completed_at, duration_seconds) values ($1, $2, $3, 'completed', true, '2026-08-17T12:00:17', '2026-08-17T13:00:17', 3464) returning id`,
        [wk, group, client]
      );
      h.check("the coach can file a backdated historical session for their client, linked to the program's workout, with a duration", session.rows.length === 1);
      const sid = session.rows[0].id;
      const ex = await db.query(`insert into public.session_exercises (session_id, exercise_name, exercise_order, group_workout_exercise_id, is_added, athlete_note) values ($1, 'Plank', 0, $2, false, 'Right hand load') returning id`, [sid, line]);
      h.check("...its exercise linked to the program's line, with the per-exercise note", ex.rows.length === 1);
      const sets = await tryQ(db, `insert into public.set_logs (session_exercise_id, set_order, weight, reps, time_seconds, height, distance, status, completed_at, is_historical) values ($1, 0, 205, 5, 30, 20, 25, 'completed', '2026-08-17T12:00:17', true), ($1, 1, 205, 5, 30, 20, 25, 'completed', '2026-08-17T12:00:17', true)`, [ex.rows[0].id]);
      h.check("...and sets with weight, reps, time, height and distance" + (sets.error ? ": " + sets.error : ""), !sets.error);
      const second = await tryQ(db, `insert into public.athlete_sessions (workout_id, group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, $3, 'completed', true, '2026-08-18T12:00:17', '2026-08-18T12:00:17')`, [wk, group, client]);
      h.check("a second session for the same program workout is refused (the importer links each workout once)", !!second.error);
      await h.asSuper();
      h.check("it made no workout log and no personal record", (await db.query("select count(*)::int as n from public.workout_logs")).rows[0].n === logsBefore && (await db.query("select count(*)::int as n from public.exercise_records")).rows[0].n === recordsBefore);

      await h.as(stranger);
      const refused = await tryQ(db, `insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, 'completed', true, '2026-08-19T12:00:17', '2026-08-19T12:00:17')`, [group, client]);
      h.check("a coach of another group cannot file history for this client", !!refused.error);
      await h.as(coach);
      const other = await tryQ(db, `insert into public.athlete_sessions (group_id, athlete_id, status, is_historical, started_at, completed_at) values ($1, $2, 'completed', true, '2026-08-19T12:00:17', '2026-08-19T12:00:17')`, [group2, client]);
      h.check("a coach cannot file it into a group they do not coach", !!other.error);

      // Undo: deleting the historical session removes its exercises and sets.
      const del = await db.query(`delete from public.athlete_sessions where id = $1 and is_historical = true returning id`, [sid]);
      h.check("undo deletes the historical session as the coach", del.rows.length === 1);
      await h.asSuper();
      h.check("...and its exercises and sets go with it", (await db.query("select count(*)::int as n from public.session_exercises where session_id = $1", [sid])).rows[0].n === 0 && (await db.query("select count(*)::int as n from public.set_logs where session_exercise_id = $1", [ex.rows[0].id])).rows[0].n === 0);
    },
  },
};
