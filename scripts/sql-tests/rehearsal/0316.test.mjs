// 0316: a program copy remembers the program it was copied from (programs.source_program_id). Proves the column starts empty for existing programs, every copy made from now on
// records its source (a personal copy for a client, a plain duplicate, a copy into another group), the copy stays fully independent, deleting the original only clears the link, and
// the copy function keeps its access and its deep copy.
export default {
  name: "0316 a program copy remembers its source",
  migrations: ["0316"],
  phases: {
    async "0316"({ db, h }) {
      const coach = await h.user("SL Coach");
      const ann = await h.user("SL Ann");
      const bo = await h.user("SL Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "SL group");
      const group2 = await h.group(org, coach, "team", "SL second group");
      await h.member(group, ann);
      await h.member(group, bo);

      await h.asSuper();
      const col = await h.one("select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id'");
      h.check("the source column exists and is optional", col && col.data_type === "uuid" && col.is_nullable === "YES", JSON.stringify(col));

      const prog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'Base', $2) returning id", [group, coach])).rows[0].id;
      const workout = (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id", [prog, group])).rows[0].id;
      await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 1)", [workout, group]);
      h.check("a program made before has no source", (await h.one("select source_program_id from public.programs where id = $1", [prog])).source_program_id === null);

      await h.as(coach);
      const forAnn = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Ann', null) as id", [prog, group, coach, ann])).id;
      const plain = (await h.one("select public.duplicate_program($1, $2, $3, null, null, null) as id", [prog, group, coach])).id;
      const elsewhere = (await h.one("select public.duplicate_program($1, $2, $3, null, null, null) as id", [prog, group2, coach])).id;
      await h.asSuper();
      const rows = await h.rows("select id, source_program_id, athlete_id from public.programs where id = any($1::uuid[])", [[forAnn, plain, elsewhere]]);
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      h.check("a copy for a client records its source", by[forAnn].source_program_id === prog && by[forAnn].athlete_id === ann, JSON.stringify(by[forAnn]));
      h.check("a plain duplicate records its source", by[plain].source_program_id === prog);
      const named = await h.one("select name from public.programs where id = $1", [forAnn]);
      const wantName = (await h.one("select 'Base ' || chr(8212) || ' Ann' as n")).n;
      h.check("a copy for a client is named 'Program - Client' with a real long dash", named.name === wantName && !/[^\x20-\x7e\u2014]/.test(named.name), JSON.stringify(named));
      h.check("a copy into another group records its source", by[elsewhere].source_program_id === prog);

      const exCount = async (p) => Number((await h.one("select count(*)::int as n from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = $1", [p])).n);
      h.check("the copy is still a full, independent deep copy", (await exCount(forAnn)) === 1 && (await exCount(prog)) === 1);

      // a copy of a copy points at the copy it came from
      await h.as(coach);
      const second = (await h.one("select public.duplicate_program($1, $2, $3, $4, 'Bo', null) as id", [forAnn, group, coach, bo])).id;
      await h.asSuper();
      h.check("a copy of a copy points at the program it was copied from", (await h.one("select source_program_id from public.programs where id = $1", [second])).source_program_id === forAnn);

      // the lookup the builder popover uses: every client copy whose source is this program
      const holders = await h.rows("select athlete_id from public.programs where source_program_id = $1 and athlete_id is not null", [prog]);
      h.check("the copies made from a program are found by its id", holders.length === 1 && holders[0].athlete_id === ann, JSON.stringify(holders));

      // deleting the original only clears the link
      await db.query("update public.programs set source_program_id = null where id = $1", [second]);
      await db.query("delete from public.programs where id = $1", [prog]);
      const survivors = await h.rows("select id, source_program_id from public.programs where id = any($1::uuid[])", [[forAnn, plain, elsewhere]]);
      h.check("deleting the original keeps every copy and only clears their link", survivors.length === 3 && survivors.every((r) => r.source_program_id === null), JSON.stringify(survivors));
      h.check("and the copies keep their workouts", (await exCount(forAnn)) === 1);

      const acl = await h.one("select has_function_privilege('authenticated', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as a, has_function_privilege('anon', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as n, (select prosecdef from pg_proc where oid = 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure) as definer");
      h.check("the copy function keeps its access (signed-in yes, signed-out no) and still runs as the caller", acl.a === true && acl.n === false && acl.definer === false, JSON.stringify(acl));
    },
  },
};
