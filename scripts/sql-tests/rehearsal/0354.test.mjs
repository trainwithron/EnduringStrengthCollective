// 0354: the money settings on an organization membership are the server's. The connected Stripe account on a membership cannot be written by the owner, another coach, a client or an anonymous caller (only
// the server, i.e. the service role); the owner can still set a member's revenue share, but the shares of an organization can never add up to more than 100%; a new owner starts at 100%.
export default {
  name: "0354 the money settings on a membership are the server's",
  migrations: ["0354"],
  phases: {
    async "0354"({ db, h }) {
      const owner = await h.user("MS Owner");
      const coachA = await h.user("MS Coach A");
      const coachB = await h.user("MS Coach B");
      const client = await h.user("MS Client");
      const org = await h.org(owner);
      await h.orgMember(org, coachA, "coach");
      await h.orgMember(org, coachB, "coach");
      const g = await h.group(org, coachA, "team", "MS team");
      await h.member(g, client);

      await h.asSuper();
      const share = async (id) => Number((await db.query(`select revenue_share_pct from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, id])).rows[0].revenue_share_pct);
      h.check("a new organization's owner starts with the whole share", (await share(owner)) === 100);

      const tryUpdate = (name, who, set) => h.expectError(name, async () => {
        const r = await db.query(`update public.organization_memberships set ${set} where organization_id = $1 and profile_id = $2 returning 1`, [org, coachA]);
        if (r.rowCount === 0) throw new Error("permission denied: no row changed");
      }, /permission denied|row-level|violates|no row changed/i);

      for (const [label, who] of [["the owner", owner], ["another coach", coachB], ["a client", client], ["an anonymous caller", null]]) {
        await h.as(who);
        await tryUpdate(`${label} cannot set a member's connected Stripe account`, who, `stripe_connect_account_id = 'acct_attacker'`);
        await tryUpdate(`${label} cannot set a member's connected-account status`, who, `stripe_connect_status = 'enabled'`);
      }
      await h.as(owner);
      await h.expectError("the owner cannot add an existing person as a member", () => db.query(`insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'coach')`, [org, client]), /permission denied|row-level|violates/i);

      // the server (service role) still can, which is how a coach connects their own account
      await h.asService();
      await db.query(`update public.organization_memberships set stripe_connect_account_id = 'acct_real', stripe_connect_status = 'pending' where organization_id = $1 and profile_id = $2`, [org, coachA]);
      h.check("the server can set a coach's connected account", (await db.query(`select stripe_connect_account_id from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, coachA])).rows[0].stripe_connect_account_id === "acct_real");

      // shares: the owner sets them; never more than 100% in total
      await h.as(owner);
      await db.query(`update public.organization_memberships set revenue_share_pct = 60 where organization_id = $1 and profile_id = $2`, [org, owner]);
      await db.query(`update public.organization_memberships set revenue_share_pct = 40 where organization_id = $1 and profile_id = $2`, [org, coachA]);
      h.check("the owner can split the shares up to exactly 100%", (await share(owner)) === 60 && (await share(coachA)) === 40);
      await h.expectError("a share that takes the total over 100% is refused in plain words", () => db.query(`update public.organization_memberships set revenue_share_pct = 10 where organization_id = $1 and profile_id = $2`, [org, coachB]), /add up to more than 100%/i);
      await h.as(coachB);
      await h.expectError("a coach cannot change anyone's share", async () => {
        const r = await db.query(`update public.organization_memberships set revenue_share_pct = 0 where organization_id = $1 and profile_id = $2 returning 1`, [org, owner]);
        if (r.rowCount === 0) throw new Error("no row changed");
      }, /permission denied|row-level|violates|no row changed/i);
      await h.as(owner);
      await db.query(`update public.organization_memberships set role = 'admin' where organization_id = $1 and profile_id = $2`, [org, coachB]);
      h.check("the owner can still change a member's role", (await db.query(`select role from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, coachB])).rows[0]?.role === "admin");
    },
  },
};
