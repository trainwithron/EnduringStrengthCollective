// 0365: pattern and class templates. The new columns exist, start empty, and refuse values outside their lists.
const msg = async (db, sql, params) => {
  try {
    await db.query(sql, params);
    return "";
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
};

export default {
  name: "0365 pattern and class template columns",
  migrations: ["0365"],
  phases: {
    async "0365"({ db, h }) {
      const coach = await h.user("PC Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "PC team");
      const client = await h.user("PC Client");
      await h.member(group, client);
      await h.asSuper();

      const cols = (await db.query(
        `select column_name from information_schema.columns where table_schema = 'public' and column_name in ('is_unilateral', 'is_slot', 'slot_side', 'slot_tier', 'training_level')`
      )).rows;
      h.check("the five new columns exist", cols.length === 5);

      const pat = (await db.query(`insert into public.movement_patterns (created_by, name) values ($1, 'PC Squat') returning id`, [coach])).rows[0].id;
      const rung = (await db.query(`insert into public.movement_pattern_exercises (movement_pattern_id, exercise_name, difficulty_rank, tier) values ($1, 'PC Goblet Squat', 1, 'B') returning is_unilateral`, [pat])).rows[0];
      h.check("a ladder exercise is two-sided unless marked", rung.is_unilateral === false);

      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'PC program', $2) returning id`, [group, coach])).rows[0].id;
      const w = (await db.query(`insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'PC day', 1, 1) returning id`, [prog, group])).rows[0].id;
      const ex = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'PC Press', 0) returning is_slot, slot_side, slot_tier`, [w, group])).rows[0];
      h.check("a workout exercise is not a slot unless marked", ex.is_slot === false && ex.slot_side === null && ex.slot_tier === null);
      h.check("a slot side other than bilateral or unilateral is refused", (await msg(db, `update public.group_workout_exercises set slot_side = 'sideways' where workout_id = $1`, [w])) !== "");
      h.check("a slot class other than A, B or C is refused", (await msg(db, `update public.group_workout_exercises set slot_tier = 'D' where workout_id = $1`, [w])) !== "");
      h.check("a training level outside beginner, intermediate, advanced is refused", (await msg(db, `update public.group_memberships set training_level = 'elite' where group_id = $1 and profile_id = $2`, [group, client])) !== "");
      h.check("a valid level is accepted", (await msg(db, `update public.group_memberships set training_level = 'intermediate' where group_id = $1 and profile_id = $2`, [group, client])) === "");
    },
  },
};
