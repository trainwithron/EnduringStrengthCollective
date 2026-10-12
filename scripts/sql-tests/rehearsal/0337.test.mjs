// 0337: assign_program_to_client attaches a program only when it and the client's space are in the SAME organization; across organizations it copies and leaves the original where it is.
export default {
  name: "0337 assigning attaches only inside one organization",
  migrations: ["0337"],
  phases: {
    async "0337"({ db, h }) {
      const coach = await h.user("AO Coach");
      const client = await h.user("AO Client");
      const orgA = await h.org(coach);
      const orgB = await h.org(coach);
      const libA = await h.group(orgA, coach, "team", "AO library A");
      const soloB = await h.group(orgB, coach, "one_on_one", "AO solo B");
      const soloA = await h.group(orgA, coach, "one_on_one", "AO solo A");
      await h.member(soloB, client);
      await h.member(soloA, client);

      await h.asSuper();
      async function inactiveProgram(name) {
        const prog = (await db.query(`insert into public.programs (group_id, name, created_by, is_active) values ($1, $2, $3, false) returning id`, [libA, name, coach])).rows[0].id;
        await db.query(`insert into public.workouts (program_id, group_id, title, day_index) values ($1, $2, 'Day 1', 1)`, [prog, libA]);
        return prog;
      }
      const programCount = async () => (await h.one(`select count(*)::int as n from public.programs`)).n;

      // Across organizations: a copy, the library program stays in organization A.
      const cross = await inactiveProgram("AO cross");
      const before = await programCount();
      await h.as(coach);
      const r1 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'AO Client', null)`, [cross, soloB, client]);
      await h.asSuper();
      h.check("into another organization it is copied, not attached", r1.was_attached === false && r1.assigned_program_id !== cross, JSON.stringify(r1));
      const still = await h.one(`select group_id, athlete_id from public.programs where id = $1`, [cross]);
      h.check("the original stays in its own organization's group with no client", still.group_id === libA && still.athlete_id === null);
      h.check("one copy was made", (await programCount()) === before + 1);

      // Same organization: attached, as before.
      const same = await inactiveProgram("AO same");
      await h.as(coach);
      const r2 = await h.one(`select * from public.assign_program_to_client($1, $2, $3, 'AO Client', null)`, [same, soloA, client]);
      await h.asSuper();
      h.check("inside one organization it is still attached", r2.was_attached === true && r2.assigned_program_id === same, JSON.stringify(r2));
    },
  },
};
