// 0377: an exercise in the library can never be named with only digits, commas, dots and spaces. Real names with numbers in them stay fine; rows already there are untouched.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0377 Library names are never only numbers",
  migrations: ["0377"],
  phases: {
    async "0377"({ db, h }) {
      const coach = await h.user("NN Coach");
      await h.as(coach);
      for (const bad of ["1", "8,8,8", "20", "5,5,5", "12.5", "3 3"]) {
        h.check(`"${bad}" is refused as a library name`, !!(await tryQ(db, `insert into public.exercise_library (created_by, name) values ($1, $2)`, [coach, bad])).error);
      }
      for (const good of ["5/3/1", "21s", "Day 1", "10x10", "Back Squat", "1.5 Rep Squat"]) {
        const r = await tryQ(db, `insert into public.exercise_library (created_by, name) values ($1, $2) returning name`, [coach, good]);
        h.check(`"${good}" is still accepted${r.error ? ": " + r.error : ""}`, !r.error && r.rows[0].name === good);
      }
      const ren = await tryQ(db, `update public.exercise_library set name = '2' where created_by = $1 and name = 'Back Squat'`, [coach]);
      h.check("a rename to only numbers is refused too", !!ren.error);
      const c = await db.query(`select convalidated from pg_constraint where conname = 'exercise_library_name_not_digits'`);
      h.check("the rule is NOT VALID (rows already there are left alone)", c.rows.length === 1 && c.rows[0].convalidated === false);
    },
  },
};
