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
    },
  },
};
