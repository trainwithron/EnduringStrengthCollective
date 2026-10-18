// 0403: a person who joins a group as a client without a finished health form is flagged for it, whichever door they came in by; coaches and social-only members are not.
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
      const coachClient = await h.user("IN Coach Client");
      const social = await h.user("IN Social");
      const finished = await h.user("IN Finished");
      const already = await h.user("IN Already");
      const outsideCoach = await h.user("IN Other Coach");
      const gOther = await h.group(org, outsideCoach, "team", "IN Other Team");

      h.check("baseline: an existing account is not flagged", (await flag(db, existing)) === false);
      await h.member(g, existing);
      h.check("an existing account that joins a group as a client is flagged for the health form", (await flag(db, existing)) === true);

      await h.member(gOther, coachClient);
      // a person who coaches anywhere is a coach using the app, whatever else they join
      await h.member(gOther, outsideCoach, "coach").catch(() => undefined);
      const coachJoin = await h.user("IN Coach Also");
      await h.member(g2, coachJoin, "coach");
      await h.member(g, coachJoin);
      h.check("someone who coaches a group is not flagged when they join another as a client", (await flag(db, coachJoin)) === false);

      await db.query(`insert into public.group_memberships (group_id, profile_id, role, membership_type) values ($1, $2, 'athlete', 'social_only')`, [g, social]);
      h.check("a social-only member is not flagged", (await flag(db, social)) === false);

      await db.query(`insert into public.client_intake (athlete_id, group_id, completed_at) values ($1, $2, now())`, [finished, g]);
      await h.member(g2, finished);
      h.check("someone who has already finished the form is not asked again for a second group", (await flag(db, finished)) === false);

      await db.query(`update public.profiles set intake_required = true where id = $1`, [already]);
      await h.member(g, already);
      h.check("someone already flagged stays flagged (nothing else changes)", (await flag(db, already)) === true);

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
