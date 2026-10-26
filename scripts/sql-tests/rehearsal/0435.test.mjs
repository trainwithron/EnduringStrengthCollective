// 0435 Organization programs: marked once (no client, not archived, in a team or social group with no clients); a client never reads one; assigning one to a client always copies it.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0435 Organization programs: never followed, only copied",
  migrations: ["0435"],
  phases: {
    // The state just before 0435 (every earlier step applied).
    async "0434"({ db, h, state }) {
      const owner = await h.user("OP Owner");
      const org = await h.org(owner, "OP Gym");
      const library = await h.group(org, owner, "team", "OP Collective");
      const team = await h.group(org, owner, "team", "OP Team");
      const client = await h.user("OP Client");
      await h.member(team, client);
      await h.asSuper();
      const mk = async (group, name, extra = "") =>
        (await h.one(`insert into public.programs (group_id, name, created_by, is_active${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, $3, true${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [group, name, owner])).id;
      const libProgram = await mk(library, "OP Library Program");
      const archived = (await h.one("insert into public.programs (group_id, name, created_by, is_active, archived_at) values ($1, 'OP Archived', $2, false, now()) returning id", [library, owner])).id;
      const teamProgram = await mk(team, "OP Team Program");
      const clientCopy = (await h.one("insert into public.programs (group_id, name, created_by, is_active, athlete_id) values ($1, 'OP Client Copy', $2, true, $3) returning id", [team, owner, client])).id;
      Object.assign(state, { owner, org, library, team, client, libProgram, archived, teamProgram, clientCopy });
    },
    async "0435"({ db, h, state }) {
      const s = state;
      const mark = async (id) => (await h.one("select org_program from public.programs where id = $1", [id])).org_program;
      h.check("a program with no client in a group with no clients is marked as the organization's", (await mark(s.libProgram)) === true);
      h.check("an archived one is not", (await mark(s.archived)) === false);
      h.check("a program in a group that has clients stays that group's", (await mark(s.teamProgram)) === false);
      h.check("a client's own copy stays theirs", (await mark(s.clientCopy)) === false);

      // A client added to the Collective afterwards never gets the organization's programs; the group's own programs still reach them.
      const later = await h.user("OP Later Client");
      await h.member(s.library, later);
      await h.asSuper();
      const groupProgram = (await h.one("insert into public.programs (group_id, name, created_by, is_active) values ($1, 'OP Collective Group Program', $2, true) returning id", [s.library, s.owner])).id;
      const seen = async (who, id) => {
        await h.as(who);
        const r = await tryQ(db, "select id from public.programs where id = $1", [id]);
        await h.asSuper();
        return (r.rows ?? []).length === 1;
      };
      h.check("a client in the Collective cannot read the organization's program", (await seen(later, s.libProgram)) === false);
      h.check("...but reads the Collective's own group program", (await seen(later, groupProgram)) === true);
      h.check("a client of another group reads their group's program as before", (await seen(s.client, s.teamProgram)) === true);
      h.check("the coach reads the organization's program", (await seen(s.owner, s.libProgram)) === true);

      // Assigning: an organization program is copied, never handed over; an ordinary unassigned program is still handed to its first client (0424).
      await h.as(s.owner);
      const assigned = await tryQ(db, "select * from public.assign_program_to_client($1, $2, $3)", [s.libProgram, s.team, s.client]);
      await h.asSuper();
      const row = assigned.rows?.[0];
      h.check("assigning the organization's program to a client makes a copy", !assigned.error && row && row.was_attached === false && row.assigned_program_id !== s.libProgram, JSON.stringify(assigned));
      const libAfter = await h.one("select group_id, athlete_id, org_program from public.programs where id = $1", [s.libProgram]);
      h.check("...and the organization's program stays in the library, still the organization's", libAfter.group_id === s.library && libAfter.athlete_id === null && libAfter.org_program === true, JSON.stringify(libAfter));
      if (row) {
        const copy = await h.one("select athlete_id, org_program from public.programs where id = $1", [row.assigned_program_id]);
        h.check("...the copy is the client's own, not an organization program", copy.athlete_id === s.client && copy.org_program === false, JSON.stringify(copy));
      }
      const plain = (await h.one("insert into public.programs (group_id, name, created_by, is_active) values ($1, 'OP Plain Template', $2, false) returning id", [s.team, s.owner])).id;
      await h.as(s.owner);
      const handed = await tryQ(db, "select * from public.assign_program_to_client($1, $2, $3)", [plain, s.team, s.client]);
      await h.asSuper();
      h.check("an ordinary unassigned program is still handed to its first client", !handed.error && handed.rows?.[0]?.was_attached === true && handed.rows[0].assigned_program_id === plain, JSON.stringify(handed));
    },
  },
};
