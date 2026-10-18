// 0403: a person who joins their FIRST group as a client without a finished health form is flagged for it, whichever door they came in by. Nobody who is already a client, or who is staff, is flagged.
const flag = async (db, id) => (await db.query(`select intake_required from public.profiles where id = $1`, [id])).rows[0].intake_required;

export default {
  name: "0403 Intake for every client",
  migrations: ["0403"],
  phases: {
    async "0403"({ db, h }) {
      const coach = await h.user("IN Coach");
      const org = await h.org(coach, "IN Gym");
      const g = await h.group(org, coach, "team", "IN Team");
      const g2 = await h.group(org, coach, "team", "IN Second");
      const existing = await h.user("IN Existing");
      const social = await h.user("IN Social");
      const finished = await h.user("IN Finished");
      const already = await h.user("IN Already");
      const legacy = await h.user("IN Legacy Client");
      const orgOwner = await h.user("IN Org Owner");
      const orgCoach = await h.user("IN Org Coach");
      const coachSeat = await h.user("IN Coach Also");

      h.check("baseline: an existing account is not flagged", (await flag(db, existing)) === false);
      await h.member(g, existing);
      h.check("an existing account that joins their first group as a client is flagged for the health form", (await flag(db, existing)) === true);

      // staff are not new clients
      await h.orgMember(org, orgCoach, "coach");
      await h.member(g, orgCoach);
      h.check("an organization's coach who joins a group as a client is not flagged", (await flag(db, orgCoach)) === false);
      const o2 = await h.org(orgOwner, "IN Other Gym");
      await h.member(g, orgOwner);
      h.check("an organization's owner who joins a group as a client is not flagged", (await flag(db, orgOwner)) === false && o2 !== null);
      await h.member(g2, coachSeat, "coach");
      await h.member(g, coachSeat);
      h.check("someone who coaches a group is not flagged when they join another as a client", (await flag(db, coachSeat)) === false);

      await db.query(`insert into public.group_memberships (group_id, profile_id, role, membership_type) values ($1, $2, 'athlete', 'social_only')`, [g, social]);
      h.check("a social-only member is not flagged", (await flag(db, social)) === false);

      await db.query(`insert into public.client_intake (athlete_id, group_id, completed_at) values ($1, $2, now())`, [finished, g]);
      await h.member(g2, finished);
      h.check("someone who has already finished the form is not asked again for a second group", (await flag(db, finished)) === false);

      await db.query(`update public.profiles set intake_required = true where id = $1`, [already]);
      await h.member(g, already);
      h.check("someone already flagged stays flagged (nothing else changes)", (await flag(db, already)) === true);

      // an existing client with no form who is already in a group is NOT swept up by joining another group, a new season or a move
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [g, legacy]);
      await db.query(`update public.profiles set intake_required = false where id = $1`, [legacy]);
      await h.member(g2, legacy);
      h.check("an existing client joining a second group is not flagged (they are not new)", (await flag(db, legacy)) === false);

      await h.as(coach);
      const next = await db.query(`select public.start_new_season($1, 'IN Team 2027', $2::uuid[]) as id`, [g, [legacy, existing]]).catch((e) => ({ error: String(e.message) }));
      await h.asSuper();
      h.check("starting next season copies the same people and flags nobody new" + (next.error ? " (" + next.error + ")" : ""), !next.error && (await flag(db, legacy)) === false);

      const mover = await h.user("IN Mover");
      const gm1 = await h.group(org, coach, "team", "IN Move From");
      const gm2 = await h.group(org, coach, "team", "IN Move To");
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [gm1, mover]);
      await db.query(`update public.profiles set intake_required = false where id = $1`, [mover]);
      await h.as(coach);
      const moved = await db.query(`select public.move_client_to_group($1, $2, $3)`, [mover, gm1, gm2]).catch((e) => ({ error: String(e.message) }));
      await h.asSuper();
      h.check("moving a client between groups flags nobody" + (moved.error ? " (" + moved.error + ")" : ""), !moved.error && (await flag(db, mover)) === false);

      // joining through the signed-in person's own session (an invite link): the flag still gets set, though the person cannot change it themselves
      const viaInvite = await h.user("IN Invite Joiner");
      const code = (await db.query(`insert into public.group_invites (group_id, code, created_by) values ($1, 'IN-CODE-1', $2) returning code`, [g, coach]).catch(() => ({ rows: [] }))).rows[0]?.code;
      if (code) {
        await h.as(viaInvite);
        const r = await db.query(`select public.join_group_with_invite($1)`, [code]).catch((e) => ({ error: String(e.message) }));
        await h.asSuper();
        h.check("an existing account joining by an invite link is flagged" + (r.error ? " (" + r.error + ")" : ""), !r.error && (await flag(db, viaInvite)) === true);
      }
      await h.as(existing);
      const own = await db.query(`update public.profiles set intake_required = false where id = $1`, [existing]);
      await h.asSuper();
      h.check("and a client still cannot switch the flag off themselves", (await flag(db, existing)) === true, String(own.rowCount));
    },
  },
};
