// 0384: privacy closures. Shared lists can only be changed by the coach who added a row; a client who is private from the organization stays private from organization admins in the places the earlier rule missed;
// ten more client tables refuse a row about a person who is not in the group; a progress photo must sit in its owner's folder.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0384 Privacy closures",
  migrations: ["0384"],
  phases: {
    async "0384"({ db, h }) {
      const coachA = await h.user("PC Coach A");
      const coachB = await h.user("PC Coach B");
      const admin = await h.user("PC Org Admin");
      const platform = await h.platformAdmin("PC Platform Admin");
      const open = await h.user("PC Open Client");
      const secret = await h.user("PC Private Client");
      const outsider = await h.user("PC Outsider");
      const org = await h.org(coachA);
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, coachB, "coach");
      const gOpen = await h.group(org, coachA, "one_on_one", "PC open space");
      const gSecret = await h.group(org, coachA, "one_on_one", "PC private space");
      const gTeam = await h.group(org, coachB, "team", "PC team");
      await h.member(gOpen, open);
      await h.member(gSecret, secret);
      await h.member(gTeam, open);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [gSecret, secret]);

      // 1. shared lists
      await h.asSuper();
      await db.query(`insert into public.usda_foods (fdc_id, description, data_type) values (1, 'a', 'Foundation'), (2, 'b', 'Foundation'), (7, 'c', 'Foundation'), (99, 'd', 'Foundation')`);
      await h.as(coachA);
      const m1 = await tryQ(db, `insert into public.builtin_ingredient_usda_mappings (ingredient_key, usda_fdc_id, mapped_by) values ('oats', 1, $1)`, [coachA]);
      h.check("a coach can add a mapping" + (m1.error ? ": " + m1.error : ""), !m1.error);
      const forged = await tryQ(db, `insert into public.builtin_ingredient_usda_mappings (ingredient_key, usda_fdc_id, mapped_by) values ('rice', 2, $1)`, [coachB]);
      h.check("but not in someone else's name", !!forged.error);
      await h.as(coachB);
      const upd = await db.query(`update public.builtin_ingredient_usda_mappings set usda_fdc_id = 99 where ingredient_key = 'oats' returning ingredient_key`);
      h.check("another coach cannot change that mapping", upd.rows.length === 0);
      const del = await db.query(`delete from public.builtin_ingredient_usda_mappings where ingredient_key = 'oats' returning ingredient_key`);
      h.check("or delete it", del.rows.length === 0);
      await h.as(platform);
      const adm = await db.query(`update public.builtin_ingredient_usda_mappings set usda_fdc_id = 7 where ingredient_key = 'oats' returning ingredient_key`);
      h.check("the platform admin can", adm.rows.length === 1);
      await h.asSuper();
      const tag = (await db.query(`insert into public.biomech_tags (name) values ('pc-tag') returning id`).catch(() => ({ rows: [] }))).rows[0];
      if (tag) {
        await h.as(coachA);
        await db.query(`insert into public.exercise_biomech_tags (exercise_name, tag_id, role, created_by) values ('PC Squat', $1, 'primary', $2)`, [tag.id, coachA]);
        await h.as(coachB);
        const t2 = await db.query(`delete from public.exercise_biomech_tags where exercise_name = 'PC Squat' returning id`);
        h.check("another coach cannot delete a movement tag they did not add", t2.rows.length === 0);
      }

      // 2. a private client stays private from the organization admin
      await h.asSuper();
      await db.query(`insert into public.client_inactive (athlete_id, group_id, since) values ($1, $2, now()), ($3, $4, now())`, [open, gOpen, secret, gSecret]);
      await db.query(`insert into public.posts (group_id, author_id, post_type, body) values ($1, $2, 'user_post', 'open'), ($3, $4, 'user_post', 'secret')`, [gOpen, open, gSecret, secret]);
      await h.as(admin);
      const seenInactive = (await db.query(`select group_id from public.client_inactive`)).rows.map((r) => r.group_id);
      h.check("an org admin still sees the open client's set-aside record", seenInactive.includes(gOpen));
      h.check("but not the private client's", !seenInactive.includes(gSecret));
      const seenPosts = (await db.query(`select group_id from public.posts`)).rows.map((r) => r.group_id);
      h.check("an org admin sees the open space's posts and not the private space's", seenPosts.includes(gOpen) && !seenPosts.includes(gSecret));
      const seenGroups = (await db.query(`select id from public.groups`)).rows.map((r) => r.id);
      h.check("an org admin does not see the private space itself", seenGroups.includes(gOpen) && !seenGroups.includes(gSecret));
      const act = await tryQ(db, `select public.set_client_inactive($1, $2, true, 'x')`, [secret, gSecret]);
      h.check("an org admin cannot set a private client aside", /not authorized/i.test(act.error ?? ""), String(act.error));
      const actOpen = await tryQ(db, `select public.set_client_inactive($1, $2, true, 'x')`, [open, gOpen]);
      h.check("an org admin still can for an open client" + (actOpen.error ? ": " + actOpen.error : ""), !actOpen.error);
      await h.as(coachA);
      const coachSees = (await db.query(`select group_id from public.client_inactive`)).rows.map((r) => r.group_id);
      h.check("the client's own coach still sees both", coachSees.includes(gOpen) && coachSees.includes(gSecret));
      const coachAct = await tryQ(db, `select public.set_client_inactive($1, $2, false, null)`, [secret, gSecret]);
      h.check("and can act" + (coachAct.error ? ": " + coachAct.error : ""), !coachAct.error);

      // the changes that decide who sees what are written to the audit trail
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = false where group_id = $1 and profile_id = $2`, [gSecret, secret]);
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [gSecret, secret]);
      const audited = await h.one(`select count(*)::int as n from public.audit_log where table_name = 'group_memberships' and row_key = $1`, [`${gSecret}:${secret}`]);
      h.check("a change of who is private from the organization is audited (" + audited.n + " entries)", audited.n >= 2);
      await db.query(`update public.organizations set restrict_cross_org_matching = not restrict_cross_org_matching where id = $1`, [org]);
      const orgAudit = await h.one(`select count(*)::int as n from public.audit_log where table_name = 'organizations' and row_key = $1`, [org]);
      h.check("so is a change to an organization's own settings", orgAudit.n >= 1);

      // 3. athlete-in-group triggers and the photo folder
      await h.as(outsider);
      h.check("a person cannot file a note about someone who is not in the group", !!(await tryQ(db, `insert into public.athlete_notes (athlete_id, group_id, author_id, body) values ($1, $2, $3, 'x')`, [open, gOpen, outsider])).error);
      await h.as(open);
      h.check("a photo outside the person's own folder is refused", !!(await tryQ(db, `insert into public.progress_photos (athlete_id, group_id, storage_path) values ($1, $2, 'someone-else/a.jpg')`, [open, gOpen])).error);
      const own = await tryQ(db, `insert into public.progress_photos (athlete_id, group_id, storage_path) values ($1, $2, $3)`, [open, gOpen, `${open}/a.jpg`]);
      h.check("a photo in their own folder is fine" + (own.error ? ": " + own.error : ""), !own.error);
    },
  },
};
