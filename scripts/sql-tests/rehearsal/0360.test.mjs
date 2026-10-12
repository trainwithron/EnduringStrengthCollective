// 0360: the person who has just created a group can seat themselves in it as its coach. Before, a new one-on-one group refused its very first membership (every one-on-one group is closed to
// organization admins, and nobody was in the group yet to be its coach), so adding a client failed. The new clause answers only for the creator, for their own row, as coach, while the group has
// no members. It cannot be used to join anyone else's group, to seat someone else, to join a group that already has members, or to join as a client.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0360 the creator of a new group can seat themselves as its coach",
  migrations: ["0358", "0360"],
  phases: {
    async "0358"({ db, h }) {
      const owner = await h.user("NG Owner");
      const org = await h.org(owner);
      await h.as(owner);
      const id = "ac000000-0000-4000-8000-000000000001";
      await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, 'NG client', $2, $3, 'one_on_one')", [id, owner, org]);
      const before = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [id, owner]);
      h.check("baseline: before 0360 the creator (an organization owner) cannot seat themselves in their new one-on-one group", !!before.error);
      await h.asSuper();
      await db.query("delete from public.groups where id = $1", [id]);
    },
    async "0360"({ db, h }) {
      const owner = await h.user("NG Owner 2");
      const rival = await h.user("NG Rival Admin");
      const stranger = await h.user("NG Stranger");
      const org = await h.org(owner);
      await h.orgMember(org, rival, "admin");

      // A new one-on-one group: the creator seats themselves.
      await h.as(owner);
      const g1 = "ac000000-0000-4000-8000-000000000011";
      await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, 'NG client 1', $2, $3, 'one_on_one')", [g1, owner, org]);
      const seat = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach') returning id", [g1, owner]);
      h.check("the creator can seat themselves as coach in their new one-on-one group" + (seat.error ? ": " + seat.error : ""), !seat.error && seat.rows.length === 1);
      const again = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g1, owner]);
      h.check("...and only while the group has no members (a second row is refused)", !!again.error);

      // A team group too.
      const g2 = "ac000000-0000-4000-8000-000000000012";
      await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, 'NG team', $2, $3, 'team')", [g2, owner, org]);
      const team = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g2, owner]);
      h.check("the same for a new team group", !team.error);

      // Not for anyone else, not as a client, not into someone else's empty group.
      const g3 = "ac000000-0000-4000-8000-000000000013";
      await db.query("insert into public.groups (id, name, created_by, organization_id, group_kind) values ($1, 'NG client 3', $2, $3, 'one_on_one')", [g3, owner, org]);
      const other = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g3, stranger]);
      h.check("the creator cannot seat someone else", !!other.error);
      const asClient = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')", [g3, owner]);
      h.check("the creator cannot seat themselves as a client", !!asClient.error);
      await h.as(rival);
      const rivalSeat = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g3, rival]);
      h.check("another organization admin cannot seat themselves in someone else's empty one-on-one group (still closed)", !!rivalSeat.error);
      await h.as(stranger);
      const strangerSeat = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g3, stranger]);
      h.check("a stranger cannot seat themselves in it", !!strangerSeat.error);

      // After the creator is in, an org admin still cannot join the one-on-one group.
      await h.as(rival);
      const lateRival = await tryQ(db, "insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')", [g1, rival]);
      h.check("once the group has its coach, another organization admin still cannot join a one-on-one group", !!lateRival.error);
    },
  },
};
