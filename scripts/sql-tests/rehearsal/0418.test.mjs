// 0418: Release AF3's database policies. Private-from-the-organization for posts and tags, the two undecided profile links, the guardian-consent answer for a coach, and the health-form flag when the last client seat goes.
const tryQ = async (db, sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  }
};

export default {
  name: "0418 AF3 database policies",
  migrations: ["0418"],
  phases: {
    async "0418"({ db, h }) {
      const owner = await h.user("AF Owner");
      const admin = await h.user("AF Admin");
      const coach = await h.user("AF Coach");
      const open = await h.user("AF Open Client");
      const priv = await h.user("AF Private Client");
      const org = await h.org(owner, "AF Gym");
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, coach, "coach");
      const g = await h.group(org, coach, "team", "AF Team");
      await h.member(g, open);
      await h.member(g, priv);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g, priv]);

      // ---- 1. posts
      await db.query(`insert into public.posts (group_id, author_id, body) values ($1, $2, 'open post'), ($1, $3, 'private post'), ($1, $4, 'coach post')`, [g, open, priv, coach]);
      const seen = async (who) => {
        await h.as(who);
        const r = await db.query(`select body from public.posts where group_id = $1 order by body`, [g]);
        await h.asSuper();
        return r.rows.map((x) => x.body);
      };
      let s = await seen(admin);
      h.check("an organization admin still sees a normal client's post and the coach's", s.includes("open post") && s.includes("coach post"), JSON.stringify(s));
      h.check("but not the post of a client marked private from the organization", !s.includes("private post"), JSON.stringify(s));
      s = await seen(owner);
      h.check("nor does the owner", !s.includes("private post") && s.includes("open post"), JSON.stringify(s));
      s = await seen(coach);
      h.check("the coach of the group sees all three", s.length === 3, JSON.stringify(s));
      s = await seen(priv);
      h.check("the private client sees their own and the group's", s.length === 3, JSON.stringify(s));
      s = await seen(open);
      h.check("another client sees the group's posts as before (all three)", s.length === 3, JSON.stringify(s));
      await h.as(admin);
      let r = await tryQ(db, `delete from public.posts where body = 'private post' returning id`);
      h.check("an organization admin cannot delete the private client's post", !r.error && r.rows.length === 0, JSON.stringify(r));
      r = await tryQ(db, `delete from public.posts where body = 'open post' returning id`);
      h.check("but can still delete a normal client's post (moderation is unchanged)", !r.error && r.rows.length === 1, JSON.stringify(r));
      await h.asSuper();

      // ---- tags
      const tag = (await db.query(`insert into public.client_tags (organization_id, name, created_by) values ($1, 'AF tag', $2) returning id`, [org, owner])).rows[0].id;
      await db.query(`insert into public.client_tag_assignments (tag_id, athlete_id) values ($1, $2), ($1, $3)`, [tag, open, priv]);
      const tagged = async (who) => {
        await h.as(who);
        const x = await db.query(`select athlete_id from public.client_tag_assignments where tag_id = $1`, [tag]);
        await h.asSuper();
        return x.rows.map((y) => y.athlete_id);
      };
      let t = await tagged(admin);
      h.check("an organization admin sees the tag on a normal client", t.includes(open), JSON.stringify(t));
      h.check("but not on a client marked private from the organization", !t.includes(priv), JSON.stringify(t));
      t = await tagged(owner);
      h.check("nor does the owner", t.includes(open) && !t.includes(priv));
      t = await tagged(coach);
      h.check("the coach of the group sees both", t.includes(open) && t.includes(priv), JSON.stringify(t));
      // one private seat is enough, in any group of the organization
      const g2 = await h.group(org, coach, "team", "AF Second Team");
      await h.member(g2, open);
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g2, open]);
      t = await tagged(admin);
      h.check("private in one group of the organization keeps the tag from the admin everywhere in it", !t.includes(open), JSON.stringify(t));

      // ---- 2. the two links nobody had decided about
      const unhandled = (await db.query(`select tbl, col from public.profile_reference_unhandled() order by 1, 2`)).rows;
      h.check("every not-null link to a profile has a decision (live-catalog guard)" + (unhandled.length ? ": " + JSON.stringify(unhandled) : ""), unhandled.length === 0);
      const pol = (await db.query(`select tbl, col, action from public.profile_reference_policy() where (tbl, col) in (('client_sub_goals','proposed_by'), ('client_assessments','created_by'))`)).rows;
      h.check("sub-goals someone proposed and assessments someone recorded go with the person", pol.length === 2 && pol.every((p) => p.action === "delete"), JSON.stringify(pol));
      // the existing decisions are untouched
      const all = (await db.query(`select count(*)::int as n from public.profile_reference_policy()`)).rows[0].n;
      h.check("the 23 earlier decisions are still there, plus two", all === 25, String(all));

      // ---- 3. the guardian-consent answer for a coach
      const teen = await h.user("AF Teen");
      await h.member(g, teen);
      await db.query(`insert into public.guardian_consents (athlete_id, guardian_email, token_hash) values ($1, 'p@example.com', 'af-h1')`, [teen]);
      const state = async (who) => {
        await h.as(who);
        const x = await tryQ(db, `select public.guardian_consent_state($1) as s`, [teen]);
        await h.asSuper();
        return x.error ? { error: x.error } : x.rows[0].s;
      };
      h.check("the child sees their own state", (await state(teen))?.state === "pending");
      h.check("their coach, in a live training group, sees it", (await state(coach))?.state === "pending");
      // a coach whose only link is a group the child has left or that is retired
      const other = await h.user("AF Other Coach");
      const otherOrg = await h.org(other, "AF Other Gym");
      const og = await h.group(otherOrg, other, "team", "AF Other Team");
      await h.member(og, teen);
      await db.query(`update public.group_memberships set membership_type = 'social_only' where group_id = $1 and profile_id = $2`, [og, teen]);
      h.check("a coach of a group where the child is only a social member is told nothing", (await state(other)) === null);
      await db.query(`update public.group_memberships set membership_type = 'training' where group_id = $1 and profile_id = $2`, [og, teen]);
      h.check("the same coach, once it is a training seat, is told", (await state(other))?.state === "pending");
      await db.query(`update public.groups set archived_at = now() where id = $1`, [og]);
      h.check("a coach of a retired (archived) group is told nothing", (await state(other)) === null);
      h.check("the other coach, whose group is live, still is told", (await state(coach))?.state === "pending");
      await h.asService();
      const svc = await tryQ(db, `select public.guardian_consent_state($1) as s`, [teen]);
      await h.asSuper();
      h.check("the server still reads it", svc.rows?.[0]?.s?.state === "pending", JSON.stringify(svc));

      // ---- 4. the health-form flag goes when the last client seat goes
      const both = await h.user("AF Coach And Client");
      await h.member(g, both, "athlete");
      await db.query(`update public.profiles set intake_required = true where id = $1`, [both]);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g, both]);
      let flag = (await db.query(`select intake_required from public.profiles where id = $1`, [both])).rows[0].intake_required;
      h.check("removing someone's only client seat clears the health-form flag", flag === false);

      const two = await h.user("AF Two Seats");
      await h.member(g, two);
      await h.member(g2, two);
      await db.query(`update public.profiles set intake_required = true where id = $1`, [two]);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g2, two]);
      flag = (await db.query(`select intake_required from public.profiles where id = $1`, [two])).rows[0].intake_required;
      h.check("removing one of two client seats leaves the flag as it was", flag === true);

      // put back: a person who never completed the form is asked again (the existing trigger), nobody skips it
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [g, two]);
      flag = (await db.query(`select intake_required from public.profiles where id = $1`, [two])).rows[0].intake_required;
      h.check("removing the last seat clears it", flag === false);
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [g, two]);
      flag = (await db.query(`select intake_required from public.profiles where id = $1`, [two])).rows[0].intake_required;
      h.check("adding a seat back asks for the form again when it was never completed", flag === true);

      // a coach removing a client through the app's own function
      const viaFn = await h.user("AF Via Function");
      await h.member(g, viaFn);
      await db.query(`update public.profiles set intake_required = true where id = $1`, [viaFn]);
      await h.as(coach);
      r = await tryQ(db, `select public.remove_client($1, $2) as id`, [g, viaFn]);
      await h.asSuper();
      flag = (await db.query(`select intake_required from public.profiles where id = $1`, [viaFn])).rows[0].intake_required;
      h.check("remove_client itself works and the flag is cleared" + (r.error ? ": " + r.error : ""), !r.error && flag === false);

      // the coach-who-is-also-a-client loop: a coach with a leftover flag
      const coachClient = await h.user("AF Coach Is Client");
      await h.member(g, coachClient, "coach");
      await h.member(g2, coachClient, "athlete");
      await db.query(`update public.profiles set intake_required = true where id = $1`, [coachClient]);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [g2, coachClient]);
      flag = (await db.query(`select intake_required from public.profiles where id = $1`, [coachClient])).rows[0].intake_required;
      h.check("a coach who was also someone's client is no longer sent to the health form after leaving", flag === false);
    },
  },
};
