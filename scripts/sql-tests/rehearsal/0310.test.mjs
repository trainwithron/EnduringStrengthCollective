// 0310: the coach's own name for an exercise. One optional column on the program's exercises; nothing else changes. Proves the column exists and starts empty, a coach can set it on their
// own program, a client can read it but not change it, another coach cannot touch it, the length limit holds, and the real exercise name is left alone.
export default {
  name: "0310 the coach's own name for an exercise",
  migrations: ["0310"],
  phases: {
    async "0310"({ db, h }) {
      const coach = await h.user("DN Coach");
      const other = await h.user("DN Other Coach");
      const ann = await h.user("DN Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "DN group");
      await h.member(group, ann);
      const otherOrg = await h.org(other);
      await h.group(otherOrg, other, "team", "DN other group");

      await h.asSuper();
      const col = await h.one("select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'group_workout_exercises' and column_name = 'display_name'");
      h.check("the display_name column exists and is optional", col && col.data_type === "text" && col.is_nullable === "YES", JSON.stringify(col));

      const prog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'P', $2) returning id", [group, coach])).rows[0].id;
      const workout = (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id", [prog, group])).rows[0].id;
      const ex = (await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Bulgarian Split Squat', 1) returning id", [workout, group])).rows[0].id;

      const row = async () => h.one("select exercise_name, display_name from public.group_workout_exercises where id = $1", [ex]);
      h.check("an existing exercise has no display name (it keeps showing its real name)", (await row()).display_name === null);

      await h.as(coach);
      await db.query("update public.group_workout_exercises set display_name = 'RFESS' where id = $1", [ex]);
      const after = await row();
      h.check("the coach can set their own name, and the real exercise name is untouched", after.display_name === "RFESS" && after.exercise_name === "Bulgarian Split Squat", JSON.stringify(after));

      await h.as(ann);
      const seen = await h.rows("select display_name from public.group_workout_exercises where id = $1", [ex]);
      h.check("the client can read the coach's name on their program", seen.length === 1 && seen[0].display_name === "RFESS", JSON.stringify(seen));
      const changed = await db.query("update public.group_workout_exercises set display_name = 'mine' where id = $1", [ex]);
      h.check("the client cannot change it", (changed.rowCount ?? 0) === 0);

      await h.as(other);
      const otherChange = await db.query("update public.group_workout_exercises set display_name = 'theirs' where id = $1", [ex]);
      h.check("another coach cannot change it", (otherChange.rowCount ?? 0) === 0);

      await h.as(coach);
      await h.expectError("a blank or over-long name is refused", () => db.query("update public.group_workout_exercises set display_name = $2 where id = $1", [ex, "x".repeat(121)]), /group_workout_exercises_display_name_len|check constraint/i);
      await h.expectError("a name of only spaces is refused", () => db.query("update public.group_workout_exercises set display_name = '   ' where id = $1", [ex]), /group_workout_exercises_display_name_len|check constraint/i);
      // ---- the program copy keeps the coach's names (and a plain exercise stays plain)
      await h.asSuper();
      await db.query("update public.group_workout_exercises set display_name = 'RFESS' where id = $1", [ex]);
      await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 2)", [workout, group]);
      await h.as(coach);
      const copyId = (await h.one("select public.duplicate_program($1, $2, $3, null, null, null) as id", [prog, group, coach])).id;
      await h.asSuper();
      const copied = await h.rows("select e.exercise_name, e.display_name from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = $1 order by e.exercise_order", [copyId]);
      h.check("a copied program keeps the coach's own name on the exercise that had one", copied.length === 2 && copied[0].exercise_name === "Bulgarian Split Squat" && copied[0].display_name === "RFESS", JSON.stringify(copied));
      h.check("an exercise with no coach name stays plain in the copy", copied[1].exercise_name === "Back Squat" && copied[1].display_name === null, JSON.stringify(copied));
      const acl = await h.one("select has_function_privilege('authenticated', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as a, has_function_privilege('anon', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as n, (select prosecdef from pg_proc where oid = 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure) as definer");
      h.check("the copy function keeps its access: signed-in users can run it, signed-out visitors cannot, and it still runs as the caller", acl.a === true && acl.n === false && acl.definer === false, JSON.stringify(acl));

      await db.query("update public.group_workout_exercises set display_name = null where id = $1", [ex]);
      await h.asSuper();
      h.check("clearing it puts the exercise back to its real name", (await row()).display_name === null);
    },
  },
};
