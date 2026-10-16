// 0380: two days of one program cannot share a day number in the same week; different weeks and different programs can.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0], code: e.code }; }
};

export default {
  name: "0380 A day number is unique inside a week of a program",
  migrations: ["0380"],
  phases: {
    async "0380"({ db, h }) {
      const coach = await h.user("DN Coach");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "DN team");
      await h.asSuper();
      const prog = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'DN program', $2) returning id`, [g, coach])).rows[0].id;
      const prog2 = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'DN program 2', $2) returning id`, [g, coach])).rows[0].id;
      const add = (p, w, d) => tryQ(db, `insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day', $3, $4) returning id`, [p, g, w, d]);
      h.check("a first day is fine", !(await add(prog, 1, 1)).error);
      const dup = await add(prog, 1, 1);
      h.check("the same week and day number again is refused (unique violation)", !!dup.error && dup.code === "23505");
      h.check("the next day number is fine", !(await add(prog, 1, 2)).error);
      h.check("the same day number in another week is fine", !(await add(prog, 2, 1)).error);
      h.check("the same week and day number in another program is fine", !(await add(prog2, 1, 1)).error);
    },
  },
};
