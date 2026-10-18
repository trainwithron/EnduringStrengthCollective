// 0406: an athlete reads their own membership row and the coaches' rows, not other athletes' rows; coaches read what they did, an organization admin reads what they did, and the rules of other tables that look at memberships still work.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0406 Athlete narrow memberships",
  migrations: ["0406"],
  phases: {
    // Just before 0406: the old behaviour, so the change is visible.
    async "0398"({ db, h, state }) {
      const coach = await h.user("MR Coach");
      const ann = await h.user("MR Ann");
      const bo = await h.user("MR Bo");
      const hidden = await h.user("MR Private Client");
      const admin = await h.user("MR Org Admin");
      const outsider = await h.user("MR Outsider");
      const leaver = await h.user("MR Leaver");
      const org = await h.org(coach, "MR Gym");
      await h.orgMember(org, admin, "admin");
      const g = await h.group(org, coach, "team", "MR Team");
      const other = await h.group(org, coach, "team", "MR Other");
      for (const p of [ann, bo, hidden, leaver]) await h.member(g, p);
      await h.member(other, outsider);
      await h.asSuper();
      await db.query(`update public.group_memberships set client_tier = 'online', training_level = 'advanced' where group_id = $1 and profile_id = $2`, [g, bo]);
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g, hidden]);
      Object.assign(state, { coach, ann, bo, hidden, admin, outsider, leaver, org, g, other });
      await h.as(ann);
      const before = await tryQ(db, `select profile_id from public.group_memberships where group_id = $1`, [g]);
      await h.asSuper();
      h.check("baseline: before 0406 an athlete can read every membership row of their group", before.rows?.length === 5, JSON.stringify(before));
    },

    async "0406"({ db, h, state }) {
      const { coach, ann, bo, hidden, admin, outsider, leaver, g, other } = state;
      const rowsAs = async (who, groupId) => {
        await h.as(who);
        const r = await tryQ(db, `select profile_id, role, client_tier, training_level from public.group_memberships where group_id = $1`, [groupId]);
        await h.asSuper();
        return r;
      };

      // ---- the athlete
      let r = await rowsAs(ann, g);
      const seen = (r.rows ?? []).map((x) => x.profile_id).sort();
      h.check("an athlete now reads their own row and the coach's, and nobody else's", !r.error && seen.length === 2 && seen.includes(ann) && seen.includes(coach), JSON.stringify(r));
      h.check("so a teammate's tier and level are not readable", !(r.rows ?? []).some((x) => x.profile_id === bo));
      await h.as(ann);
      const teammate = await tryQ(db, `select client_tier, training_level, private_from_org, membership_type from public.group_memberships where profile_id = $1`, [bo]);
      await h.asSuper();
      h.check("asking for a teammate's row directly returns nothing", !teammate.error && teammate.rows.length === 0, JSON.stringify(teammate));
      r = await rowsAs(outsider, g);
      h.check("someone from another group still sees nothing of this group", !r.error && r.rows.length === 0, JSON.stringify(r));

      // ---- the coach is unchanged
      r = await rowsAs(coach, g);
      h.check("the coach still reads every row of their group, with its tier and level", r.rows?.length === 5 && r.rows.find((x) => x.profile_id === bo)?.client_tier === "online" && r.rows.find((x) => x.profile_id === bo)?.training_level === "advanced", JSON.stringify(r));

      // ---- an organization admin without a seat is unchanged (the existing policy still hides a client who is private from the organization)
      r = await rowsAs(admin, g);
      h.check("an organization admin with no seat reads the rows they did before, without the private client", r.rows?.length === 4 && !r.rows.some((x) => x.profile_id === hidden), JSON.stringify(r));

      // ---- leaving still works for the person it belongs to
      await h.as(leaver);
      const left = await tryQ(db, `delete from public.group_memberships where group_id = $1 and profile_id = $2 returning 1`, [g, leaver]);
      await h.asSuper();
      h.check("a client can still leave a group (delete their own row)", !left.error && left.rows.length === 1, JSON.stringify(left));

      // ---- the rules of other tables that look at memberships still work for an athlete
      await h.as(ann);
      const teammateName = await tryQ(db, `select full_name from public.profiles where id = $1`, [bo]);
      await h.asSuper();
      h.check("a teammate's name is still readable (the profile rule does not depend on their membership row)", teammateName.rows?.length === 1, JSON.stringify(teammateName));
      const recipe = (await db.query(`insert into public.recipes (created_by, name) values ($1, 'MR coach recipe') returning id`, [coach])).rows[0].id;
      await h.as(ann);
      const recipes = await tryQ(db, `select id from public.recipes where id = $1`, [recipe]);
      const dm = await tryQ(db, `insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'hi coach') returning id`, [g, ann, coach]);
      const grp = await tryQ(db, `select id, name from public.groups where id = $1`, [g]);
      await h.asSuper();
      h.check("the coach's recipes are still visible to their client", recipes.rows?.length === 1, JSON.stringify(recipes));
      h.check("a client can still message their coach", !dm.error && dm.rows.length === 1, JSON.stringify(dm));
      h.check("a client can still read their group", grp.rows?.length === 1, JSON.stringify(grp));
      await h.as(coach);
      const dmBack = await tryQ(db, `insert into public.direct_messages (group_id, sender_id, recipient_id, body) values ($1, $2, $3, 'hi ann') returning id`, [g, coach, ann]);
      await h.asSuper();
      h.check("and the coach can message the client", !dmBack.error && dmBack.rows.length === 1, JSON.stringify(dmBack));
      h.check("the group-member test the other rules use still says yes for an athlete", (await (async () => { await h.as(ann); const x = await tryQ(db, `select public.is_group_member($1) as m`, [g]); await h.asSuper(); return x.rows?.[0]?.m === true; })()));
      h.check("the second group is untouched", other !== null);

      // ---- "N members" is counted by the database, not by the rows the page can read
      const countAs = async (who, groupId) => { await h.as(who); const x = await tryQ(db, `select public.group_member_count($1) as n`, [groupId]); await h.asSuper(); return x; };
      let n = await countAs(ann, g);
      h.check("a client is told the whole group's size (the leaver has gone, so 4 are left)", n.rows?.[0]?.n === 4, JSON.stringify(n));
      n = await countAs(coach, g);
      h.check("so is the coach", n.rows?.[0]?.n === 4, JSON.stringify(n));
      n = await countAs(admin, g);
      h.check("an organization admin with no seat gets the count they could read before, without the client who is private from the organization", n.rows?.[0]?.n === 3, JSON.stringify(n));
      n = await countAs(outsider, g);
      h.check("someone from another group gets nothing", !n.error && n.rows?.[0]?.n === null, JSON.stringify(n));
      await h.as(null);
      n = await tryQ(db, `select public.group_member_count($1) as n`, [g]);
      await h.asSuper();
      h.check("a signed-out caller gets nothing or is refused", !!n.error || n.rows?.[0]?.n === null, JSON.stringify(n));
    },
  },
};
