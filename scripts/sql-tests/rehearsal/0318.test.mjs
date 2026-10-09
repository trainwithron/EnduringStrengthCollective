// 0318: a program copy is named "Program - Client" without stacking. Proves a shared program gets the client added, a client's copy given to someone else swaps the client tail instead of stacking,
// the same client twice adds nothing, no client name leaves the name alone, a coach's own dash in a shared program's name is kept, and the copy is still a full deep copy with its access unchanged.
export default {
  name: "0318 copy names do not stack",
  migrations: ["0318"],
  phases: {
    async "0318"({ db, h }) {
      const coach = await h.user("CN Coach");
      const ann = await h.user("CN Ann");
      const bo = await h.user("CN Bo");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "CN group");
      await h.member(group, ann);
      await h.member(group, bo);

      await h.asSuper();
      const dash = (await h.one("select chr(8212) as d")).d;
      const nm = (base, client) => `${base} ${dash} ${client}`;
      const prog = (await db.query("insert into public.programs (group_id, name, created_by) values ($1, 'Base', $2) returning id", [group, coach])).rows[0].id;
      const workout = (await db.query("insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1) returning id", [prog, group])).rows[0].id;
      await db.query("insert into public.group_workout_exercises (workout_id, group_id, exercise_name, exercise_order) values ($1, $2, 'Back Squat', 1)", [workout, group]);

      const copy = async (source, athlete, clientName) => {
        await h.as(coach);
        const id = (await h.one("select public.duplicate_program($1, $2, $3, $4, $5, null) as id", [source, group, coach, athlete, clientName])).id;
        await h.asSuper();
        return { id, name: (await h.one("select name from public.programs where id = $1", [id])).name };
      };

      const forAnn = await copy(prog, ann, "Ann");
      h.check("a shared program for a client is named Program - Client", forAnn.name === nm("Base", "Ann"), forAnn.name);
      const forBo = await copy(forAnn.id, bo, "Bo");
      h.check("Ann's copy given to Bo swaps the client instead of stacking", forBo.name === nm("Base", "Bo"), forBo.name);
      const forBoAgain = await copy(forBo.id, bo, "Bo");
      h.check("the same client again adds nothing", forBoAgain.name === nm("Base", "Bo"), forBoAgain.name);
      const sameFromShared = await copy(prog, ann, "Ann");
      h.check("assigning the shared program to the same client twice gives the same plain name", sameFromShared.name === nm("Base", "Ann"), sameFromShared.name);
      const noName = await copy(prog, null, null);
      h.check("no client name leaves the name unchanged", noName.name === "Base", noName.name);

      // a coach's own dash in a shared program's name is kept (only a client's copy loses its tail)
      await db.query("update public.programs set name = $2 where id = $1", [prog, `Phase 1 ${dash} Strength`]);
      const dashed = await copy(prog, ann, "Ann");
      h.check("a shared program with its own dash keeps it and adds the client", dashed.name === `Phase 1 ${dash} Strength ${dash} Ann`, dashed.name);
      const dashedToBo = await copy(dashed.id, bo, "Bo");
      h.check("and handing that client's copy on drops only the client tail", dashedToBo.name === `Phase 1 ${dash} Strength ${dash} Bo`, dashedToBo.name);

      // existing programs are not renamed, and the copy is still a full deep copy
      h.check("the source program was not renamed by copying", (await h.one("select name from public.programs where id = $1", [prog])).name === `Phase 1 ${dash} Strength`);
      const exCount = Number((await h.one("select count(*)::int as n from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id where w.program_id = $1", [forBo.id])).n);
      h.check("the copy is still a full deep copy", exCount === 1);
      const acl = await h.one("select has_function_privilege('authenticated', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as a, has_function_privilege('anon', 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)', 'execute') as n, (select prosecdef from pg_proc where oid = 'public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure) as definer");
      h.check("the copy function keeps its access (signed-in yes, signed-out no) and still runs as the caller", acl.a === true && acl.n === false && acl.definer === false, JSON.stringify(acl));
    },
  },
};
