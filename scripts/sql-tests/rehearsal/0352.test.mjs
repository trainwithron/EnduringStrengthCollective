// 0352: joining an organization needs the person's OK. The owner can no longer insert a membership for someone else; an invited person accepts or declines; only they can answer; any member can leave
// (not the owner, and not as the only coach of a group that has clients).
export default {
  name: "0352 joining an organization needs the person's OK",
  migrations: ["0352"],
  phases: {
    async "0352"({ db, h }) {
      const owner = await h.user("OI Owner");
      const coach = await h.user("OI Coach");
      const invitee = await h.user("OI Invitee");
      const stranger = await h.user("OI Stranger");
      const client = await h.user("OI Client");
      const org = await h.org(owner);
      await h.orgMember(org, coach, "coach");
      const team = await h.group(org, owner, "team", "OI team");
      const soloOwn = await h.group(org, coach, "team", "OI coach team");
      await h.member(soloOwn, client);

      await h.as(owner);
      await h.expectError("the owner cannot put an existing person into the organization", async () => {
        await db.query(`insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'coach')`, [org, stranger]);
      }, /row-level security|violates|policy/i);

      await h.asSuper();
      const inv = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, group_id, created_by) values ($1, $2, 'coach', $3, $4) returning id`, [org, invitee, team, owner])).rows[0].id;

      await h.as(stranger);
      await h.expectError("a stranger cannot answer someone else's invitation", () => db.query(`select public.answer_organization_invite($1, true)`, [inv]), /not found/i);
      h.check("...and cannot see it", (await db.query(`select count(*)::int as n from public.organization_invites where id = $1`, [inv])).rows[0].n === 0);

      await h.as(invitee);
      h.check("the invited person sees their invitation", (await db.query(`select count(*)::int as n from public.organization_invites where id = $1`, [inv])).rows[0].n === 1);
      await db.query(`select public.answer_organization_invite($1, true)`, [inv]);
      await h.asSuper();
      h.check("accepting makes the organization membership", (await db.query(`select count(*)::int as n from public.organization_memberships where organization_id = $1 and profile_id = $2 and role = 'coach'`, [org, invitee])).rows[0].n === 1);
      h.check("...and the coach seat in the group the invitation named", (await db.query(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'coach'`, [team, invitee])).rows[0].n === 1);
      await h.as(invitee);
      await h.expectError("an invitation can be answered once", () => db.query(`select public.answer_organization_invite($1, false)`, [inv]), /already been answered/i);

      // declining makes nothing
      await h.asSuper();
      const inv2 = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, created_by) values ($1, $2, 'admin', $3) returning id`, [org, stranger, owner])).rows[0].id;
      await h.as(stranger);
      await db.query(`select public.answer_organization_invite($1, false)`, [inv2]);
      await h.asSuper();
      h.check("declining makes no membership", (await db.query(`select count(*)::int as n from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, stranger])).rows[0].n === 0);

      // a group that holds a client who is private from the organization never gets a new coach seat from an invitation
      await h.asSuper();
      const priv = await h.user("OI Private Client");
      const secret = await h.group(org, owner, "team", "OI private team");
      await h.member(secret, priv);
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [secret, priv]);
      const inv3 = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, group_id, created_by) values ($1, $2, 'coach', $3, $4) returning id`, [org, stranger, secret, owner])).rows[0].id;
      await h.as(stranger);
      await db.query(`select public.answer_organization_invite($1, true)`, [inv3]);
      await h.asSuper();
      h.check("accepting joins the organization but takes no coach seat in a group with a private client", (await db.query(`select (select count(*) from public.organization_memberships where organization_id = $1 and profile_id = $2)::int as m, (select count(*) from public.group_memberships where group_id = $3 and profile_id = $2 and role = 'coach')::int as g`, [org, stranger, secret])).rows[0].m === 1 && (await db.query(`select count(*)::int as g from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'coach'`, [secret, stranger])).rows[0].g === 0);

      // leaving
      await h.as(owner);
      await h.expectError("the owner cannot leave", () => db.query(`select public.leave_organization($1)`, [org]), /owner cannot leave/i);
      await h.as(coach);
      await h.expectError("a coach who is the only coach of a group with clients cannot leave it behind", () => db.query(`select public.leave_organization($1)`, [org]), /only coach/i);
      await h.as(invitee);
      await db.query(`select public.leave_organization($1)`, [org]);
      await h.asSuper();
      h.check("a member can leave: the membership and their coach seats go", (await db.query(`select (select count(*) from public.organization_memberships where organization_id = $1 and profile_id = $2)::int + (select count(*) from public.group_memberships where group_id = $3 and profile_id = $2)::int as n`, [org, invitee, team])).rows[0].n === 0);
    },
  },
};
