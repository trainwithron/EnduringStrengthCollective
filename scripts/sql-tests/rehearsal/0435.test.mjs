// 0435 Organization programs: the Collective's 5 programs (by id) are marked once; every other program stays its group's, a team with no athletes yet included; a client never reads an
// organization program; assigning one to a client always copies it.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

const COLLECTIVE = "44444444-4444-4444-4444-444444444444";
const FIVE = ["a6102694-0297-4142-b73f-e391649418be", "2738d78a-2b5f-4286-a249-adbedcf15459", "2143be95-1aa8-42a1-98f2-42c9b2b131bc", "4d029d91-cbb1-4a78-9e96-4f31c9263999", "a117a12b-7ca3-4765-88cc-aae150585424"];

export default {
  name: "0435 Organization programs: never followed, only copied",
  migrations: ["0435"],
  phases: {
    // The state just before 0435 (every earlier step applied).
    async "0434"({ db, h, state }) {
      const owner = await h.user("OP Owner");
      const org = await h.org(owner, "OP Gym");
      await h.asSuper();
      // The Collective, under its real id, with its 5 programs under theirs.
      await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, 'OP Collective', $2, $3, 'team')", [COLLECTIVE, owner, org]);
      await db.query("insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [COLLECTIVE, owner]);
      for (const [i, id] of FIVE.entries()) await db.query("insert into public.programs (id, group_id, name, created_by, is_active) values ($1, $2, $3, $4, $5)", [id, COLLECTIVE, `OP Library ${i + 1}`, owner, i < 3]);
      // A team with no athletes yet (like the Trojans): its program is the team's, waiting for members.
      const waitingTeam = await h.group(org, owner, "team", "OP Trojans");
      const team = await h.group(org, owner, "team", "OP Team");
      const client = await h.user("OP Client");
      await h.member(team, client);
      await h.asSuper();
      const mk = async (group, name) => (await h.one("insert into public.programs (group_id, name, created_by, is_active) values ($1, $2, $3, true) returning id", [group, name, owner])).id;
      const waitingProgram = await mk(waitingTeam, "OP 8-Week Team Program");
      const teamProgram = await mk(team, "OP Team Program");
      const clientCopy = (await h.one("insert into public.programs (group_id, name, created_by, is_active, athlete_id) values ($1, 'OP Client Copy', $2, true, $3) returning id", [team, owner, client])).id;
      Object.assign(state, { owner, org, waitingTeam, team, client, waitingProgram, teamProgram, clientCopy });
    },
    async "0435"({ db, h, state }) {
      const s = state;
      const mark = async (id) => (await h.one("select org_program from public.programs where id = $1", [id])).org_program;
      const marked = await h.rows("select id from public.programs where org_program order by id");
      h.check("exactly the Collective's 5 programs are marked as the organization's", JSON.stringify(marked.map((r) => r.id)) === JSON.stringify([...FIVE].sort()), JSON.stringify(marked));
      h.check("a team with no athletes yet keeps its program (it is waiting for members)", (await mark(s.waitingProgram)) === false);
      h.check("a program in a group that has clients stays that group's", (await mark(s.teamProgram)) === false);
      h.check("a client's own copy stays theirs", (await mark(s.clientCopy)) === false);

      const seen = async (who, id) => {
        await h.as(who);
        const r = await tryQ(db, "select id from public.programs where id = $1", [id]);
        await h.asSuper();
        return (r.rows ?? []).length === 1;
      };
      // An athlete joining the team that was waiting gets its program.
      const joiner = await h.user("OP Joiner");
      await h.member(s.waitingTeam, joiner);
      h.check("an athlete who joins the team that was waiting reads its program", (await seen(joiner, s.waitingProgram)) === true);

      // A client added to the Collective afterwards never gets the organization's programs; the Collective's own group program still reaches them.
      const later = await h.user("OP Later Client");
      await h.member(COLLECTIVE, later);
      await h.asSuper();
      const groupProgram = (await h.one("insert into public.programs (group_id, name, created_by, is_active) values ($1, 'OP Collective Group Program', $2, true) returning id", [COLLECTIVE, s.owner])).id;
      h.check("a client in the Collective cannot read the organization's programs", (await seen(later, FIVE[0])) === false && (await seen(later, FIVE[2])) === false);
      h.check("...but reads the Collective's own group program", (await seen(later, groupProgram)) === true);
      h.check("a client of another group reads their group's program as before", (await seen(s.client, s.teamProgram)) === true);
      h.check("the coach reads the organization's programs", (await seen(s.owner, FIVE[0])) === true);

      // Assigning: an organization program is copied, never handed over; an ordinary unassigned program is still handed to its first client (0424).
      await h.as(s.owner);
      const assigned = await tryQ(db, "select * from public.assign_program_to_client($1, $2, $3)", [FIVE[3], s.team, s.client]);
      await h.asSuper();
      const row = assigned.rows?.[0];
      h.check("assigning the organization's program to a client makes a copy", !assigned.error && row && row.was_attached === false && row.assigned_program_id !== FIVE[3], JSON.stringify(assigned));
      const libAfter = await h.one("select group_id, athlete_id, org_program from public.programs where id = $1", [FIVE[3]]);
      h.check("...and the organization's program stays in the library, still the organization's", libAfter.group_id === COLLECTIVE && libAfter.athlete_id === null && libAfter.org_program === true, JSON.stringify(libAfter));
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
