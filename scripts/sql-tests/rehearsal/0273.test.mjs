// 0273: columns on groups and organizations that should only change through a controlled path. The holes exist on the live schema today;
// this proves them, proves the fix, and proves the legitimate updates (rename, branding, ownership transfer, switching a group's kind) still work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0273 groups and organizations: protected columns",
  migrations: ["0273"],
  phases: {
    async live({ db, h, state }) {
      const owner = await h.user("G Owner");
      const admin = await h.user("G Admin");
      const member = await h.user("G Member");
      const coach = await h.user("G Coach");
      const a1 = await h.user("G Client A");
      const a2 = await h.user("G Client B");
      const org = await h.org(owner, "Guard org");
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, member, "coach");
      const other = await h.user("G Other Owner");
      const org2 = await h.org(other, "Other org");
      const team = await h.group(org, coach, "team", "G team");
      await h.member(team, a1);
      await h.member(team, a2);
      Object.assign(state, { owner, admin, member, coach, org, org2, team, a1, a2 });

      await h.as(admin);
      const own = await tryQ(db, `update public.organizations set owner_id = $2 where id = $1 returning owner_id`, [org, admin]);
      await h.asSuper();
      h.check("baseline: on the live schema an org admin can make themselves the owner with a plain update (the hole 0273 closes)", own.rows?.[0]?.owner_id === admin, JSON.stringify(own));
      await db.query(`update public.organizations set owner_id = $2 where id = $1`, [org, owner]);
      await h.as(coach);
      const move = await tryQ(db, `update public.groups set organization_id = $2 where id = $1 returning organization_id`, [team, org2]);
      await h.asSuper();
      h.check("baseline: and a coach can move their group into another organization", move.rows?.[0]?.organization_id === org2, JSON.stringify(move));
      await db.query(`update public.groups set organization_id = $2 where id = $1`, [team, org]);
    },

    async "0273"({ db, h, state }) {
      const { owner, admin, member, coach, org, org2, team, a1 } = state;
      await h.as(admin);
      const own = await tryQ(db, `update public.organizations set owner_id = $2 where id = $1`, [org, admin]);
      h.check("after 0273 an org admin cannot make themselves the owner", /Only the owner/i.test(own.error ?? ""), JSON.stringify(own));
      const fee = await tryQ(db, `update public.organizations set platform_fee_pct = 0 where id = $1`, [org]);
      h.check("nor change the platform fee", /platform fee/i.test(fee.error ?? ""), JSON.stringify(fee));
      const brand = await tryQ(db, `update public.organizations set accent_color = '#112233', display_name = 'Renamed' where id = $1 returning accent_color`, [org]);
      h.check("an admin can still update branding", brand.rows?.[0]?.accent_color === "#112233", JSON.stringify(brand));

      await h.as(owner);
      const toStranger = await tryQ(db, `update public.organizations set owner_id = $2 where id = $1`, [org, coach]);
      h.check("the owner cannot hand ownership to someone who is not a member of the organization", /Only the owner/i.test(toStranger.error ?? ""), JSON.stringify(toStranger));
      const transfer = await tryQ(db, `select public.transfer_organization_ownership($1, $2)`, [org, member]);
      await h.asSuper();
      const now = (await h.one(`select owner_id from public.organizations where id = $1`, [org])).owner_id;
      h.check("the owner can still transfer ownership to a member through the function", !transfer.error && now === member, JSON.stringify({ transfer, now }));
      await h.asService();
      await db.query(`update public.organizations set owner_id = $2, platform_fee_pct = 12 where id = $1`, [org, owner]);
      await h.asSuper();
      const ownerBack = (await h.one(`select owner_id, platform_fee_pct from public.organizations where id = $1`, [org]));
      h.check("the server (service role) can still change both", ownerBack.owner_id === owner && Number(ownerBack.platform_fee_pct) === 12, JSON.stringify(ownerBack));

      await h.as(coach);
      const move = await tryQ(db, `update public.groups set organization_id = $2 where id = $1`, [team, org2]);
      h.check("a coach cannot move their group to another organization", /another organization/i.test(move.error ?? ""), JSON.stringify(move));
      const creator = await tryQ(db, `update public.groups set created_by = $2 where id = $1`, [team, a1]);
      h.check("nor change who created it", /created a group/i.test(creator.error ?? ""), JSON.stringify(creator));
      const solo = await tryQ(db, `update public.groups set group_kind = 'one_on_one' where id = $1`, [team]);
      h.check("nor turn a group with two clients into a one-on-one space", /holds one client/i.test(solo.error ?? ""), JSON.stringify(solo));
      const rename = await tryQ(db, `update public.groups set name = 'G team renamed', focus_tag = 'Strength', team_mode = true where id = $1 returning name`, [team]);
      h.check("renaming, the focus tag and team mode still work", rename.rows?.[0]?.name === "G team renamed", JSON.stringify(rename));
      const social = await tryQ(db, `update public.groups set group_kind = 'social' where id = $1 returning group_kind`, [team]);
      h.check("switching a group between team and social still works", social.rows?.[0]?.group_kind === "social", JSON.stringify(social));
      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [team, state.a2]);
      await h.as(coach);
      const toSolo = await tryQ(db, `update public.groups set group_kind = 'one_on_one' where id = $1 returning group_kind`, [team]);
      h.check("a group with a single client can be switched to one-on-one", toSolo.rows?.[0]?.group_kind === "one_on_one", JSON.stringify(toSolo));
      await h.asSuper();
    },
  },
};
