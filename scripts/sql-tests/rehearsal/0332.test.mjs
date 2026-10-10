// 0332: in a one-on-one space a program with no client on it is the coach's template, not the client's: the client cannot read it (nor its workouts, exercises, sets, notes). A program
// made FOR the client, a team group's shared program, and everything a coach sees are unchanged. Nothing is changed or deleted.
export default {
  name: "0332 a one-on-one client cannot read the space's no-client programs",
  migrations: ["0332"],
  phases: {
    async "0332"({ db, h }) {
      const coach = await h.user("OO Coach");
      const will = await h.user("OO Will");
      const ann = await h.user("OO Ann");
      const org = await h.org(coach);
      const solo = await h.group(org, coach, "one_on_one", "OO solo");
      const team = await h.group(org, coach, "team", "OO team");
      await h.member(solo, will);
      await h.member(team, ann);

      await h.asSuper();
      async function build(group, athlete, name) {
        const prog = (await db.query(`insert into public.programs (group_id, name, created_by, athlete_id) values ($1, $2, $3, $4) returning id`, [group, name, coach, athlete])).rows[0].id;
        const w = (await db.query(`insert into public.workouts (program_id, group_id, title, day_index, athlete_id) values ($1, $2, 'Day 1', 1, $3) returning id`, [prog, group, athlete])).rows[0].id;
        const e = (await db.query(`insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields, athlete_id) values ($1, $2, 'Squat', 0, array['reps'], $3) returning id`, [w, group, athlete])).rows[0].id;
        await db.query(`insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps) values ($1, 0, '5')`, [e]);
        await db.query(`insert into public.workout_notes (workout_id, group_id, body, position, created_by, athlete_id) values ($1, $2, 'note', 0, $3, $4)`, [w, group, coach, athlete]);
        return { prog, w, e };
      }
      const template = await build(solo, null, "Another client's template");
      const ownCopy = await build(solo, will, "Will's own program");
      const teamShared = await build(team, null, "Team program");

      const counts = async (p) =>
        h.one(
          `select (select count(*) from public.programs where id = $1)::int as programs,
                  (select count(*) from public.workouts where program_id = $1)::int as workouts,
                  (select count(*) from public.group_workout_exercises where workout_id = $2)::int as exercises,
                  (select count(*) from public.group_workout_exercise_sets where group_workout_exercise_id = $3)::int as sets,
                  (select count(*) from public.workout_notes where workout_id = $2)::int as notes`,
          [p.prog, p.w, p.e]
        );

      await h.as(will);
      const tClient = await counts(template);
      h.check("a one-on-one client cannot read a no-client program in their space, nor anything under it", Object.values(tClient).every((n) => n === 0), JSON.stringify(tClient));
      const mine = await counts(ownCopy);
      h.check("...but reads the program made for them, and everything under it", Object.values(mine).every((n) => n === 1), JSON.stringify(mine));
      const listed = await h.rows(`select name from public.programs where group_id = $1`, [solo]);
      h.check("their list in their own space is only their own program", listed.length === 1 && listed[0].name === "Will's own program", JSON.stringify(listed));

      await h.as(coach);
      const tCoach = await counts(template);
      h.check("the coach still reads the template and everything under it", Object.values(tCoach).every((n) => n === 1), JSON.stringify(tCoach));
      const copy = await h.one(`select public.duplicate_program($1, $2, $3, $4, 'Will') as id`, [template.prog, solo, coach, will]);
      h.check("the coach can still copy the template to the client", !!copy.id);

      await h.as(ann);
      const tTeam = await counts(teamShared);
      h.check("a team group is unchanged: a member still reads the group's shared program", Object.values(tTeam).every((n) => n === 1), JSON.stringify(tTeam));

      await h.asSuper();
      const still = await h.one(`select count(*)::int as n from public.programs where name = 'Another client''s template'`);
      h.check("nothing was changed or deleted", still.n === 1);
      const acl = await h.one(`select has_function_privilege('anon', 'public.is_one_on_one_group(uuid)', 'execute') as a`);
      h.check("the helper is not callable by visitors", acl.a === false);

      // ONE-TIME ATTACH of two live programs to their own clients (run here again from the migration's own text, on rows with the live ids).
      const { readFileSync } = await import("node:fs");
      const sql = readFileSync(new URL("../../../supabase/migrations/0332_one_on_one_private_programs.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
      const block = sql.slice(sql.indexOf("do $attach$"), sql.indexOf("$attach$;") + "$attach$;".length);
      h.check("(setup) the migration holds the attach block", block.startsWith("do $attach$") && block.endsWith("$attach$;"));
      await h.asSuper();
      const KAR = { user: "edbb1e6d-0be5-458b-a83e-77ae2a2ca5c8", group: "b497af92-5525-4d70-83c4-42acddff402a", prog: "d15055ab-acd9-47f7-aeef-31c2519b20cc" };
      const JOH = { user: "e7ab9284-4b52-4a7b-aa2e-cf98e519ff6f", group: "1b4aae6a-9b51-40fb-ac1d-89cab8105cab", prog: "1f223214-efef-4883-bc3d-d5486854cf9e" };
      async function seed(x, name) {
        await db.query("insert into auth.users (id, email) values ($1, $2)", [x.user, name.toLowerCase().replace(" ", ".") + "@example.com"]);
        await db.query("insert into public.profiles (id, full_name) values ($1, $2)", [x.user, name]);
        await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, $2, $3, $4, 'one_on_one')", [x.group, name + " space", coach, org]);
        await db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach'), ($1, $3, 'athlete')", [x.group, coach, x.user]);
        await db.query("insert into public.programs (id, group_id, name, created_by) values ($1, $2, $3, $4)", [x.prog, x.group, name + " program", coach]);
        const w = (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id", [x.prog, x.group])).rows[0].id;
        await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order, tracked_fields) values ($1, $2, 'Squat', 0, array['reps'])", [w, x.group]);
        await db.query("insert into public.workout_notes (workout_id, group_id, body, position, created_by) values ($1, $2, 'n', 0, $3)", [w, x.group, coach]);
      }
      await seed(KAR, "Karina Test");
      await seed(JOH, "Johann Test");
      const other = (await db.query(`insert into public.programs (group_id, name, created_by) values ($1, 'Max anthony stand-in', $2) returning id`, [solo, coach])).rows[0].id;
      await db.query(block);
      const attached = async (x) =>
        h.one(
          `select (select athlete_id from public.programs where id = $1) as prog,
                  (select count(*)::int from public.workouts where program_id = $1 and athlete_id = $2) as w,
                  (select count(*)::int from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = $1 and e.athlete_id = $2) as e,
                  (select count(*)::int from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = $1 and n.athlete_id = $2) as n`,
          [x.prog, x.user]
        );
      const k = await attached(KAR);
      const j = await attached(JOH);
      h.check("Karina's program (and its workout, exercise, note) now belongs to Karina", k.prog === KAR.user && k.w === 1 && k.e === 1 && k.n === 1, JSON.stringify(k));
      h.check("Johann's program belongs to Johann, not to Karina: nothing links the two", j.prog === JOH.user && j.w === 1 && j.e === 1 && j.n === 1 && j.prog !== k.prog, JSON.stringify(j));
      const notes = await h.one("select count(*)::int as n from public.notifications where type = 'program_assigned' and profile_id in ($1, $2)", [KAR.user, JOH.user]);
      h.check("attaching leaves no \"your coach assigned you a new program\" notice behind", notes.n === 0, String(notes.n));
      const untouched = await h.one("select athlete_id from public.programs where id = $1", [other]);
      h.check("any other no-client program is left alone", untouched.athlete_id === null);
      await h.as(KAR.user);
      const seen = await h.rows("select id from public.programs where group_id = $1", [KAR.group]);
      h.check("Karina can still read her program under the new rule", seen.length === 1 && seen[0].id === KAR.prog);
      await h.asSuper();
      await db.query(block);
      h.check("running the attach again changes nothing", (await attached(KAR)).prog === KAR.user);
      // A different shape stops it and changes nothing: the space's client is someone else now.
      await db.query("update public.programs set athlete_id = null where id = $1", [JOH.prog]);
      await db.query("update public.workouts set athlete_id = null where program_id = $1", [JOH.prog]);
      const extra = await h.user("Extra Client");
      await db.query("delete from public.group_memberships where group_id = $1 and profile_id = $2", [JOH.group, JOH.user]);
      await h.member(JOH.group, extra);
      await h.expectError("a program whose space is not as expected stops the attach", () => db.query(block), /nothing was changed/i);
      const notAttached = await h.one("select athlete_id from public.programs where id = $1", [JOH.prog]);
      h.check("...and that program was not attached", notAttached.athlete_id === null);
    },
  },
};
