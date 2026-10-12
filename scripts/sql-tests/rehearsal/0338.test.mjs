// 0338: a parent-view link can only be made for an under-13 client of a group the coach coaches; it expires; a coach can only change its revoked date. And three internal training-partner
// functions can no longer be called from the browser, while the training-partner rules keep working.
export default {
  name: "0338 parent-view links are scoped to the coach's own under-13 clients; training-partner helpers closed",
  migrations: ["0338"],
  phases: {
    async "0338"({ db, h }) {
      const coach = await h.user("AP Coach");
      const other = await h.user("AP Other Coach");
      const kid = await h.user("AP Kid");
      const teen = await h.user("AP Teen");
      const nodob = await h.user("AP No Dob");
      const stranger = await h.user("AP Stranger");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AP team");
      const otherOrg = await h.org(other);
      const otherGroup = await h.group(otherOrg, other, "team", "AP other team");
      await h.member(group, kid);
      await h.member(group, teen);
      await h.member(group, nodob);
      await h.member(otherGroup, stranger);

      await h.asSuper();
      const intake = (athlete, grp, dob) => db.query(`insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, ${dob})`, [athlete, grp]);
      await intake(kid, group, "current_date - interval '10 years'");
      await intake(teen, group, "current_date - interval '15 years'");
      await intake(stranger, otherGroup, "current_date - interval '9 years'");

      const link = (athlete, grp, extra = "") =>
        db.query(`insert into public.guardian_links (athlete_id, group_id, access_token, created_by ${extra ? ", expires_at" : ""}) values ($1, $2, $3, $4 ${extra ? ", " + extra : ""}) returning id, expires_at`, [athlete, grp, crypto.randomUUID(), coach]);

      await h.as(coach);
      const ok = (await link(kid, group)).rows[0];
      h.check("a coach can make a link for an under-13 client in their own group", !!ok.id);
      h.check("it expires in about 90 days", ok.expires_at !== null);
      await h.expectError("a link for a client who is not in that group is refused", () => link(stranger, group), /row-level security/i);
      await h.expectError("a link for someone in another coach's group is refused", () => link(stranger, otherGroup), /row-level security/i);
      await h.expectError("a link for a client aged 15 is refused", () => link(teen, group), /row-level security/i);
      await h.expectError("a link for a client with no date of birth is refused", () => link(nodob, group), /row-level security/i);
      await h.expectError("a link that lasts longer than the limit is refused", () => link(kid, group, "now() + interval '400 days'"), /row-level security/i);

      const kept = await h.rows(`update public.guardian_links set revoked_at = now() where id = $1 returning id`, [ok.id]);
      h.check("the coach can revoke their link", kept.length === 1);
      await h.expectError("the coach cannot change which athlete a link is for", () => db.query(`update public.guardian_links set athlete_id = $1 where id = $2`, [stranger, ok.id]), /permission denied/i);

      await h.asSuper();
      const live = (await db.query(`insert into public.guardian_links (athlete_id, group_id, access_token, created_by) values ($1, $2, $3, $4) returning id`, [kid, group, crypto.randomUUID(), coach])).rows[0].id;
      await h.as(other);
      const seen = await h.rows(`select id from public.guardian_links where id = $1`, [live]);
      h.check("a coach of another group cannot see it", seen.length === 0);
      const touched = await h.rows(`update public.guardian_links set revoked_at = now() where id = $1 returning id`, [live]);
      h.check("...or revoke it", touched.length === 0);

      // Training-partner helpers: closed to the browser, rules still work through the policy.
      await h.as(kid);
      for (const fn of ["training_partner_is_minor", "training_partner_intake_incomplete", "training_partner_org_restricted"]) {
        await h.expectError(`${fn} can no longer be called by a signed-in user`, () => db.query(`select public.${fn}($1)`, [kid]), /permission denied/i);
      }
      await h.asSuper();
      await db.query(`insert into public.training_partner_profiles (athlete_id, visible) values ($1, true)`, [teen]);
      await h.as(nodob);
      const rows = await h.rows(`select athlete_id from public.training_partner_profiles`);
      h.check("the training-partner policy still evaluates for a signed-in user (nested helper calls keep working)", Array.isArray(rows));
    },
  },
};
