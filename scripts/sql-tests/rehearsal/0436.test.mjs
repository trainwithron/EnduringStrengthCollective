// 0436 Release audit fixes: a client never reads an organization program's days, exercises, sets, notes or progression rules (in their own group); the coach does; a group's copy of
// it is read as before. team_sheet_save never saves into an organization program's workout. Imports are marked while written. One fixed search_path. A copy keeps each set's type.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0436 Release audit fixes: organization programs' days closed to clients",
  migrations: ["0436"],
  phases: {
    // The state just before 0436.
    async "0435"({ db, h, state }) {
      const owner = await h.user("RA Owner");
      const org = await h.org(owner, "RA Gym");
      const team = await h.group(org, owner, "team", "RA Team");
      const client = await h.user("RA Client");
      await h.member(team, client);
      await h.asSuper();
      // The organization's own program, stored in the team (its anchor), and the team's own copy of it.
      const build = async (orgProgram, name) => {
        const p = (await h.one("insert into public.programs (group_id, name, created_by, is_active, org_program) values ($1, $2, $3, $4, $5) returning id", [team, name, owner, !orgProgram, orgProgram])).id;
        const w = (await h.one("insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id", [p, team])).id;
        const e = (await h.one("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 0) returning id", [w, team])).id;
        await db.query("insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')", [e]);
        await db.query("insert into public.workout_notes (workout_id, group_id, body, position, created_by) values ($1, $2, 'Brace hard', 0, $3)", [w, team, owner]);
        await db.query("insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by) values ($1, $2, 'Back Squat', 'linear', '{}'::jsonb, $3)", [p, team, owner]);
        return { p, w, e };
      };
      const orgP = await build(true, "RA Organization Program");
      const copyP = await build(false, "RA Team Copy");
      // A program with a warm-up set, a working set and a drop set, for the copies below.
      const typed = (await h.one("insert into public.programs (group_id, name, created_by, is_active) values ($1, 'RA Typed Sets', $2, false) returning id", [team, owner])).id;
      const tw = (await h.one("insert into public.workouts (program_id, group_id, title, week_number, day_index) values ($1, $2, 'Day 1', 1, 1) returning id", [typed, team])).id;
      const te = (await h.one("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Bench Press', 0) returning id", [tw, team])).id;
      await db.query("insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps, set_type) values ($1, 0, '10', 'warmup'), ($1, 1, '5', 'working'), ($1, 2, '12', 'drop')", [te]);
      // a second client, so the assign below copies (the first person gets the original itself)
      const client2 = await h.user("RA Client Two");
      await h.member(team, client2);
      await h.asSuper();
      Object.assign(state, { owner, client, client2, team, orgP, copyP, typed });
    },
    async "0436"({ db, h, state }) {
      const s = state;
      const reads = async (who, x) => {
        await h.as(who);
        const n = async (sql, id) => ((await tryQ(db, sql, [id])).rows ?? []).length;
        const r = {
          workout: await n("select id from public.workouts where id = $1", x.w),
          exercise: await n("select id from public.group_workout_exercises where id = $1", x.e),
          sets: await n("select id from public.group_workout_exercise_sets where group_workout_exercise_id = $1", x.e),
          notes: await n("select id from public.workout_notes where workout_id = $1", x.w),
          rules: await n("select id from public.exercise_progressions where program_id = $1", x.p),
        };
        await h.asSuper();
        return r;
      };
      const none = (r) => Object.values(r).every((v) => v === 0);
      const all = (r) => Object.values(r).every((v) => v === 1);
      const c1 = await reads(s.client, s.orgP);
      h.check("a client of the group reads none of an organization program's days, exercises, sets, notes or rules", none(c1), JSON.stringify(c1));
      const c2 = await reads(s.owner, s.orgP);
      h.check("the coach reads all of them", all(c2), JSON.stringify(c2));
      const c3 = await reads(s.client, s.copyP);
      h.check("a group's copy of it is read by the group's client as before", all(c3), JSON.stringify(c3));

      const sheet = await h.one("select pg_get_functiondef(to_regprocedure('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)')) as d");
      h.check("team_sheet_save only saves into a workout of an active group program that is not the organization's", sheet.d.includes("and pr.is_active and pr.athlete_id is null and not pr.org_program"));

      const col = await h.one("select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'importing'");
      h.check("programs.importing is there, false unless an import marks it", col && col.column_default === "false" && col.is_nullable === "NO", JSON.stringify(col));
      const marked = await h.one("select count(*)::int as n from public.programs where importing");
      h.check("no existing program is marked as importing", marked.n === 0);

      const types = async (programId) =>
        (await h.rows("select s.set_type from public.group_workout_exercise_sets s join public.group_workout_exercises g on g.id = s.group_workout_exercise_id join public.workouts w on w.id = g.workout_id where w.program_id = $1 order by s.set_order", [programId])).map((r) => r.set_type).join(",");
      await h.as(s.owner);
      const dup = await tryQ(db, "select public.duplicate_program($1, $2, $3) as id", [s.typed, s.team, s.owner]);
      await h.asSuper();
      const dupId = dup.rows?.[0]?.id;
      h.check("duplicate_program keeps each set's type (warm-up, working, drop)", !dup.error && (await types(dupId)) === "warmup,working,drop", JSON.stringify(dup));
      // Assigning: the first client gets the program itself; the second gets a copy, through duplicate_program.
      await h.as(s.owner);
      const first = await tryQ(db, "select * from public.assign_program_to_client($1, $2, $3)", [dupId, s.team, s.client]);
      const second = await tryQ(db, "select * from public.assign_program_to_client($1, $2, $3)", [dupId, s.team, s.client2]);
      await h.asSuper();
      const row = second.rows?.[0];
      h.check("assign_program_to_client's copy keeps each set's type", !first.error && !second.error && row && row.was_attached === false && (await types(row.assigned_program_id)) === "warmup,working,drop", JSON.stringify({ first, second }));

      const sp = await h.one("select proconfig from pg_proc where oid = to_regprocedure('public.training_partners_cross_org_enabled()')");
      h.check("training_partners_cross_org_enabled has a fixed, empty search_path", JSON.stringify(sp.proconfig) === JSON.stringify(['search_path=""']), JSON.stringify(sp.proconfig));
    },
  },
};
