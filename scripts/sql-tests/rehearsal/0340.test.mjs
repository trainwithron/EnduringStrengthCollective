// 0340: a signed-in user can only file a row about a person who belongs to the row's group; a client moves only inside one organization; an org admin can't join a private client's space; a comment stays in its post's group.
export default {
  name: "0340 a row about a person must be filed in a group the person belongs to",
  migrations: ["0340"],
  phases: {
    async "0340"({ db, h }) {
      const coachA = await h.user("AR Coach A");
      const coachB = await h.user("AR Coach B");
      const orgAdmin = await h.user("AR Org Admin");
      const victim = await h.user("AR Victim");
      const mine = await h.user("AR Mine");
      const orgA = await h.org(coachA);
      const orgB = await h.org(coachB);
      await h.orgMember(orgA, orgAdmin, "admin");
      const gA = await h.group(orgA, coachA, "team", "AR team A");
      const gA2 = await h.group(orgA, coachA, "team", "AR team A2");
      const soloA = await h.group(orgA, coachA, "one_on_one", "AR solo A");
      const gB = await h.group(orgB, coachB, "team", "AR team B");
      await h.member(gA, victim);
      await h.member(gB, mine);
      // coach B also coaches a group in org A, so B can act in two organizations
      await h.member(gA2, coachB, "coach");

      const day = "2030-01-01";
      const macros = (who, grp, by) => db.query(`insert into public.daily_macros (athlete_id, group_id, log_date, created_by) values ($1, $2, $3, $4)`, [who, grp, day, by]);

      // 1. A stranger coach cannot file rows about someone who is not in the group.
      await h.as(coachB);
      await h.expectError("a coach cannot plant macro targets for a person who is not in the group", () => macros(victim, gB, coachB), /not a member of this group/i);
      await h.expectError("...or forge parental consent", () => db.query(`insert into public.minor_consent (athlete_id, group_id, verified) values ($1, $2, true)`, [victim, gB]), /not a member of this group/i);
      await h.expectError("...or file a session for them", () => db.query(`insert into public.athlete_sessions (athlete_id, group_id) values ($1, $2)`, [victim, gB]), /not a member of this group/i);
      await macros(mine, gB, coachB);
      h.check("a coach can still file a row for their own client", true);
      await h.asSuper();
      const planted = await h.one(`select count(*)::int as n from public.daily_macros where athlete_id = $1`, [victim]);
      h.check("nothing was planted for the victim", planted.n === 0);

      // 2. The server (service role / superuser) is not blocked, and an old row can be edited after the person left the group.
      await h.asSuper();
      await macros(victim, gB, coachB);
      await h.as(coachB);
      const edited = await h.rows(`update public.daily_macros set calories = 1800 where athlete_id = $1 returning athlete_id`, [victim]);
      h.check("editing an old row without changing who or where it is filed still works", edited.length === 1);
      await h.expectError("moving it to be about someone else is refused", () => db.query(`update public.daily_macros set athlete_id = $1 where athlete_id = $2`, [mine, victim]), /unique|duplicate|not a member/i);

      // 3. Moving a client: same organization, and a real client of the source group.
      await h.as(coachB);
      await h.expectError("a client cannot be moved from one organization to another", () => db.query(`select public.move_client_to_group($1, $2, $3)`, [mine, gB, gA2]), /same organization/i);
      await h.expectError("a co-coach cannot be moved as if they were a client", () => db.query(`select public.move_client_to_group($1, $2, $3)`, [coachB, gB, gB]), /same organization|not a client|already a member/i);
      await h.expectError("editing a membership across organizations is refused", () => db.query(`update public.group_memberships set group_id = $1 where group_id = $2 and profile_id = $3`, [gA2, gB, mine]), /same organization/i);

      // 4. An org admin cannot add themselves to a one-on-one space, but can still join an ordinary group of their org.
      await h.as(orgAdmin);
      await h.expectError("an org admin cannot add themselves as coach of a one-on-one space", () => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [soloA, orgAdmin]), /row-level security/i);
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [gA, orgAdmin]);
      await h.asSuper();
      const joined = await h.one(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'coach'`, [gA, orgAdmin]);
      h.check("...but can still add themselves to an ordinary group of their organization", joined.n === 1);

      // 5. A comment stays in its post's group.
      await h.asSuper();
      const post = (await db.query(`insert into public.posts (group_id, author_id) values ($1, $2) returning id`, [gA, victim])).rows[0].id;
      await h.member(gA2, victim);
      await h.as(victim);
      const c = await h.rows(`insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'hi') returning id`, [post, gA, victim]);
      h.check("a member can comment on a post in its group", c.length === 1);
      await h.expectError("a comment cannot be saved in a different group from its post", () => db.query(`insert into public.comments (post_id, group_id, author_id, body) values ($1, $2, $3, 'x')`, [post, gA2, victim]), /row-level security/i);
      await h.expectError("...or moved there later", () => db.query(`update public.comments set group_id = $1 where id = $2`, [gA2, c[0].id]), /row-level security/i);
    },
  },
};
