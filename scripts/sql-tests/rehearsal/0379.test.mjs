// 0379: a program day's exercise name and a logged session's exercise name never hold only numbers or sets and reps. Real names stay fine; rows already there are untouched.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0379 Program and session exercise names are never only numbers or sets and reps",
  migrations: ["0379"],
  phases: {
    async "0379"({ db, h }) {
      const coach = await h.user("SN Coach");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "SN team");
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'SN program', $2) returning id`, [g, coach])).rows[0].id;
      const w = (await db.query(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id`, [prog, g])).rows[0].id;
      const sess = (await db.query(`insert into public.athlete_sessions (athlete_id, group_id) values ($1, $2) returning id`, [coach, g]).catch(() => ({ rows: [{ id: null }] }))).rows[0].id;
      const bad = ["10,10,10", "20", "8,8,8", "Sumo Squat 3x10", "Squat 3 sets", "Squat 10 reps", "Row @7", "Bench 3×5"];
      const good = ["Back Squat", "5/3/1", "21s", "Pause Squat @ 3 sec", "3 Rep Pause Squat", "Hex Bar Deadlift"];
      for (const name of bad) {
        h.check(`"${name}" is refused on a program day`, !!(await tryQ(db, `insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, $3, 0)`, [w, g, name])).error);
      }
      for (const name of good) {
        const r = await tryQ(db, `insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, $3, 0) returning exercise_name`, [w, g, name]);
        h.check(`"${name}" is still accepted on a program day${r.error ? ": " + r.error : ""}`, !r.error && r.rows[0].exercise_name === name);
      }
      const ren = await tryQ(db, `update public.group_workout_exercises set exercise_name = '8,8,8' where workout_id = $1 and exercise_name = 'Back Squat'`, [w]);
      h.check("a rename to only numbers is refused", !!ren.error);
      if (sess) {
        for (const name of bad) {
          h.check(`"${name}" is refused on a logged session`, !!(await tryQ(db, `insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, $2, 0)`, [sess, name])).error);
        }
        const ok = await tryQ(db, `insert into public.session_exercises (session_id, exercise_name, exercise_order) values ($1, 'Back Squat', 0) returning exercise_name`, [sess]);
        h.check("a real name is still accepted on a logged session" + (ok.error ? ": " + ok.error : ""), !ok.error);
      }
      const c = await db.query(`select conname, convalidated from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits')`);
      h.check("both rules are NOT VALID (rows already there are left alone)", c.rows.length === 2 && c.rows.every((r) => r.convalidated === false));
    },
  },
};
