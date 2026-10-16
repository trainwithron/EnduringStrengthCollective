// 0377: the library (and what an alias points to) never holds a name that is only numbers or that carries sets and reps. Real names with numbers in them stay fine; rows already there are untouched.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0377 Library names are never only numbers or sets and reps",
  migrations: ["0377"],
  phases: {
    async "0377"({ db, h }) {
      const coach = await h.user("NN Coach");
      await h.as(coach);
      const bad = ["1", "8,8,8", "20", "5,5,5", "12.5", "3 3", "Sumo Squat 3x10", "Bench 3 x 8-12", "Bench 3×5", "Squat 3 sets", "Squat 3 set of 10", "Squat 10 reps", "Row @7", "sumo squat 3X10", "10x10"];
      for (const name of bad) {
        h.check(`"${name}" is refused as a library name`, !!(await tryQ(db, `insert into public.exercise_library (created_by, name) values ($1, $2)`, [coach, name])).error);
      }
      const good = ["5/3/1", "21s", "Day 1", "Hex Bar Deadlift", "Barbell Back Squat", "1.5 Rep Squat", "3 Rep Pause Squat", "Reps Row", "Sets Of Three", "Zercher Squat", "T-Bar Row 2", "Wall Sit", "Pause Squat @ 3 sec", "Pause Bench @ 2 Second Hold"];
      for (const name of good) {
        const r = await tryQ(db, `insert into public.exercise_library (created_by, name) values ($1, $2) returning name`, [coach, name]);
        h.check(`"${name}" is still accepted${r.error ? ": " + r.error : ""}`, !r.error && r.rows[0].name === name);
      }
      const ren = await tryQ(db, `update public.exercise_library set name = 'Back Squat 3x5' where created_by = $1 and name = 'Zercher Squat'`, [coach]);
      h.check("a rename to a name with sets and reps is refused too", !!ren.error);
      const al = await tryQ(db, `insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values ($1, 'squat sumo', 'Sumo Squat 3x10')`, [coach]);
      h.check("an alias cannot point to a name with sets and reps", !!al.error);
      const alOk = await tryQ(db, `insert into public.exercise_aliases (coach_id, raw_name, exercise_name) values ($1, 'squat sumo', 'Sumo Squat') returning exercise_name`, [coach]);
      h.check("an alias to a real name is fine" + (alOk.error ? ": " + alOk.error : ""), !alOk.error);
      const c = await db.query(`select conname, convalidated from pg_constraint where conname in ('exercise_library_name_not_digits', 'exercise_aliases_target_not_digits')`);
      h.check("both rules are NOT VALID (rows already there are left alone)", c.rows.length === 2 && c.rows.every((r) => r.convalidated === false));
    },
  },
};
