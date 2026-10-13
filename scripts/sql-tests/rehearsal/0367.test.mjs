// 0367: a rest can be a range. The low end stays in target_rest_seconds, the high end is a new empty column; a single time has no high end; the high end must be above the low end; Duplicate copies it.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0367 a rest can be a range (60-90)",
  migrations: ["0365", "0366", "0367"],
  phases: {
    async "0367"({ db, h }) {
      const coach = await h.user("RR Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "RR team");
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'RR program', $2) returning id`, [group, coach])).rows[0].id;
      const w = (await db.query(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id`, [prog, group])).rows[0].id;
      const ex = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 0) returning id`, [w, group])).rows[0].id;
      const insertSet = (order, low, high) => db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, target_rest_seconds, target_rest_max_seconds) values ($1, $2, '5', $3, $4)`, [ex, order, low, high]);

      await insertSet(0, 60, 90);
      await insertSet(1, 90, null);
      h.check("a range and a single time can both be saved", (await db.query(`select count(*)::int as n from public.group_workout_exercise_sets where group_workout_exercise_id = $1`, [ex])).rows[0].n === 2);
      h.check("a range refused when its high end is not above the low end", (await msg(db, `insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_rest_seconds, target_rest_max_seconds) values ($1, 2, 90, 60)`, [ex])).includes("rest_range"));
      h.check("a range refused with no low end", (await msg(db, `insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_rest_max_seconds) values ($1, 3, 90)`, [ex])).includes("rest_range"));
      h.check("a range refused above 30 minutes", (await msg(db, `insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_rest_seconds, target_rest_max_seconds) values ($1, 4, 90, 1900)`, [ex])).includes("rest_range"));

      const copy = (await db.query(`select public.duplicate_program($1, $2, $3, null, null, null) as id`, [prog, group, coach])).rows[0].id;
      const copied = (await db.query(`select s.target_rest_seconds::int as lo, s.target_rest_max_seconds::int as hi from public.group_workout_exercise_sets s join public.group_workout_exercises e on e.id = s.group_workout_exercise_id join public.workouts w on w.id = e.workout_id where w.program_id = $1 order by s.set_order`, [copy])).rows;
      h.check("Duplicate copies a range and a single time exactly", copied.length === 2 && copied[0].lo === 60 && copied[0].hi === 90 && copied[1].lo === 90 && copied[1].hi === null);
    },
  },
};
