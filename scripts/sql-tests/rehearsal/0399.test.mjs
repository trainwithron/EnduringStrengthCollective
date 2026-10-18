// 0399: a client's health screening answers are read by the client, their coach, and an owner/admin the OWNER has granted; the address and device of an acceptance only by the audit path.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0399 Health answers private",
  migrations: ["0399"],
  phases: {
    async "0399"({ db, h }) {
      const owner = await h.user("HA Owner");
      const admin = await h.user("HA Admin");
      const coach = await h.user("HA Coach");
      const otherCoach = await h.user("HA Other Coach");
      const client = await h.user("HA Client");
      const privateClient = await h.user("HA Private Client");
      const org = await h.org(owner, "HA Gym");
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, coach, "coach");
      await h.orgMember(org, otherCoach, "coach");
      const g1 = await h.group(org, coach, "one_on_one", "HA client");
      await h.member(g1, client);
      const g2 = await h.group(org, coach, "one_on_one", "HA private client");
      await h.member(g2, privateClient);
      const g3 = await h.group(org, otherCoach, "one_on_one", "HA someone else's client");
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [g2, privateClient]);
      const answers = JSON.stringify([{ question: "Do you have a heart condition?", answer: true }]);
      for (const [a, g] of [[client, g1], [privateClient, g2]]) {
        await db.query(`insert into public.client_intake (athlete_id, group_id, par_q_answers, waiver_accepted, completed_at) values ($1, $2, $3::jsonb, true, now())`, [a, g, answers]);
      }
      await db.query(`insert into public.legal_acceptances (profile_id, document, version, ip, user_agent) values ($1, 'waiver', 'v1', '203.0.113.9', 'TestBrowser/1.0')`, [client]);
      const answersFor = async (who, athlete) => {
        await h.as(who);
        const r = await tryQ(db, `select public.health_answers($1) as a`, [athlete]);
        await h.asSuper();
        return r.rows?.[0]?.a ?? null;
      };

      // ---- the client and their coach
      h.check("the client reads their own answers", Array.isArray(await answersFor(client, client)));
      h.check("their coach reads them", Array.isArray(await answersFor(coach, client)));
      h.check("another coach of the gym does not", (await answersFor(otherCoach, client)) === null);
      h.check("another client does not", (await answersFor(privateClient, client)) === null);

      // ---- the table no longer hands the answers out, but still says whether the form is done
      await h.as(coach);
      let r = await tryQ(db, `select par_q_answers from public.client_intake where athlete_id = $1`, [client]);
      h.check("the answers column cannot be read straight from the table, even by the coach", !!r.error, JSON.stringify(r));
      await h.as(owner);
      r = await tryQ(db, `select completed_at from public.client_intake where athlete_id = $1`, [client]);
      h.check("the owner still sees that the form is done" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1 && r.rows[0].completed_at != null);
      r = await tryQ(db, `select par_q_answers from public.client_intake where athlete_id = $1`, [client]);
      h.check("but not the answers", !!r.error);
      await h.asSuper();
      h.check("the owner and the admin get nothing from the answers function until the owner grants it", (await answersFor(owner, client)) === null && (await answersFor(admin, client)) === null);

      // ---- the owner's grant
      await h.as(admin);
      r = await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, admin]);
      h.check("an admin cannot give themselves access", !!r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, coach]);
      h.check("a coach cannot either", !!r.error);
      await h.as(owner);
      r = await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, coach]);
      h.check("the owner cannot grant it to a plain coach (that is a role, not a grant)", !!r.error);
      r = await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, admin]);
      h.check("the owner grants the admin" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      h.check("the admin now reads the answers", Array.isArray(await answersFor(admin, client)));
      h.check("the owner still does not (a grant is per person)", (await answersFor(owner, client)) === null);
      h.check("a client who keeps their records private from the organization stays private even with a grant", (await answersFor(admin, privateClient)) === null && Array.isArray(await answersFor(coach, privateClient)));
      await h.as(owner);
      r = await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, owner]);
      h.check("the owner can give themselves access", !r.error);
      await h.as(admin);
      r = await tryQ(db, `select count(*)::int as n from public.health_access_grants where organization_id = $1`, [org]);
      h.check("an admin can see who has the access", r.rows?.[0]?.n === 2, JSON.stringify(r));
      await h.as(coach);
      r = await tryQ(db, `select count(*)::int as n from public.health_access_grants where organization_id = $1`, [org]);
      h.check("a coach cannot", r.rows?.[0]?.n === 0, JSON.stringify(r));
      await h.as(owner);
      r = await tryQ(db, `select public.set_health_access($1, $2, false)`, [org, admin]);
      await h.asSuper();
      h.check("taking it back works at once", !r.error && (await answersFor(admin, client)) === null);
      // an admin who stops being an admin loses a grant
      await h.as(owner);
      await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, admin]);
      await h.asSuper();
      await db.query(`delete from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, admin]);
      h.check("a person who leaves the organization loses a grant they held", (await db.query(`select count(*)::int as n from public.health_access_grants where organization_id = $1 and profile_id = $2`, [org, admin])).rows[0].n === 0);

      // ---- a grant ends with the ROLE, not only with the membership
      await db.query(`insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'admin')`, [org, admin]);
      await h.as(owner);
      await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, admin]);
      await h.asSuper();
      h.check("the admin has it again", Array.isArray(await answersFor(admin, client)));
      await db.query(`update public.organization_memberships set role = 'coach' where organization_id = $1 and profile_id = $2`, [org, admin]);
      await db.query(`update public.organization_memberships set role = 'admin' where organization_id = $1 and profile_id = $2`, [org, admin]);
      h.check("demoted and promoted again, they do NOT get the old grant back", (await answersFor(admin, client)) === null);
      await h.as(owner);
      await tryQ(db, `select public.set_health_access($1, $2, true)`, [org, owner]);
      await h.asSuper();
      await db.query(`update public.organization_memberships set role = 'admin' where organization_id = $1 and profile_id = $2`, [org, owner]);
      h.check("an owner who hands the organization over (steps down to admin) loses the grant they held", (await db.query(`select count(*)::int as n from public.health_access_grants where organization_id = $1 and profile_id = $2`, [org, owner])).rows[0].n === 0);
      await db.query(`update public.organization_memberships set role = 'owner' where organization_id = $1 and profile_id = $2`, [org, owner]);

      // ---- access follows the client's CURRENT groups
      await db.query(`update public.group_memberships set group_id = $1 where group_id = $2 and profile_id = $3`, [g3, g1, client]);
      h.check("after the client moved to another coach's group, that coach reads the answers", Array.isArray(await answersFor(otherCoach, client)));
      h.check("and the former coach no longer does", (await answersFor(coach, client)) === null);
      await db.query(`update public.group_memberships set group_id = $1 where group_id = $2 and profile_id = $3`, [g1, g3, client]);

      // ---- only a TRAINING membership in a live group counts
      const socialCoach = await h.user("HA Social Coach");
      const retiredCoach = await h.user("HA Retired Coach");
      const outsideSocialCoach = await h.user("HA Outside Social Coach");
      const secondCoach = await h.user("HA Second Coach");
      await h.orgMember(org, socialCoach, "coach");
      await h.orgMember(org, retiredCoach, "coach");
      const org2 = await h.org(outsideSocialCoach, "HA Other Gym");
      const org3 = await h.org(secondCoach, "HA Third Gym");
      const gSocial = await h.group(org, socialCoach, "team", "HA social group");
      await h.member(gSocial, client);
      const gRetired = await h.group(org, retiredCoach, "team", "HA retired season");
      await h.member(gRetired, client);
      const gOutsideSocial = await h.group(org2, outsideSocialCoach, "team", "HA other org social group");
      await h.member(gOutsideSocial, client);
      const gSecond = await h.group(org3, secondCoach, "team", "HA second coach group");
      await h.member(gSecond, client);
      await db.query("update public.group_memberships set membership_type = 'social_only' where profile_id = $1 and group_id = any ($2::uuid[])", [client, [gSocial, gOutsideSocial]]);
      await db.query("update public.groups set archived_at = now() where id = $1", [gRetired]);
      h.check("a coach of a group the client is only in socially (same organization) cannot read the answers", (await answersFor(socialCoach, client)) === null);
      h.check("nor a coach of a social group in another organization", (await answersFor(outsideSocialCoach, client)) === null);
      h.check("nor the coach of a retired season", (await answersFor(retiredCoach, client)) === null);
      h.check("but a second real coach of the same client (a training membership in another organization) reads them", Array.isArray(await answersFor(secondCoach, client)));
      h.check("and the client's own coach still does", Array.isArray(await answersFor(coach, client)));
      await db.query("update public.group_memberships set membership_type = 'training' where profile_id = $1 and group_id = $2", [client, gSocial]);
      h.check("the same coach reads them once the membership is a training one", Array.isArray(await answersFor(socialCoach, client)));
      await db.query("delete from public.group_memberships where profile_id = $1 and group_id = any ($2::uuid[])", [client, [gSocial, gRetired, gOutsideSocial, gSecond]]);

      // ---- signed-out visitors hold nothing on these tables
      h.check("signed-out visitors have no access to the intake table", (await db.query(`select has_table_privilege('anon', 'public.client_intake', 'select') or has_table_privilege('anon', 'public.client_intake', 'insert') or has_table_privilege('anon', 'public.client_intake', 'update') as p`)).rows[0].p === false);
      h.check("nor the acceptances table", (await db.query(`select has_table_privilege('anon', 'public.legal_acceptances', 'select') or has_table_privilege('anon', 'public.legal_acceptances', 'insert') as p`)).rows[0].p === false);

      // ---- the batch door used by the program assignment
      await h.as(coach);
      r = await tryQ(db, `select athlete_id from public.health_answers_many($1::uuid[])`, [[client, privateClient, otherCoach]]);
      h.check("the batch door returns only the clients this coach may read", r.rows?.length === 2, JSON.stringify(r));
      await h.as(otherCoach);
      r = await tryQ(db, `select athlete_id from public.health_answers_many($1::uuid[])`, [[client, privateClient]]);
      h.check("and none for a coach who does not coach them", (r.rows ?? []).length === 0, JSON.stringify(r));
      await h.asSuper();

      // ---- the address and device of an acceptance
      await h.as(coach);
      r = await tryQ(db, `select ip from public.legal_acceptances where profile_id = $1`, [client]);
      h.check("a coach cannot read the address an acceptance came from", !!r.error);
      r = await tryQ(db, `select user_agent from public.legal_acceptances where profile_id = $1`, [client]);
      h.check("nor the device", !!r.error);
      r = await tryQ(db, `select document, version, accepted_at from public.legal_acceptances where profile_id = $1`, [client]);
      h.check("but still sees that the waiver was accepted and when" + (r.error ? ": " + r.error : ""), !r.error && r.rows.length === 1);
      await h.as(client);
      r = await tryQ(db, `select ip from public.legal_acceptances where profile_id = $1`, [client]);
      h.check("the client cannot read it from the table either", !!r.error);
      r = await tryQ(db, `select * from public.legal_acceptance_audit($1)`, [client]);
      h.check("the audit function refuses a signed-in person", !!r.error);
      await h.asService();
      r = await tryQ(db, `select ip, user_agent from public.legal_acceptance_audit($1)`, [client]);
      h.check("the server's audit path returns them" + (r.error ? ": " + r.error : ""), !r.error && r.rows[0]?.ip === "203.0.113.9" && r.rows[0]?.user_agent === "TestBrowser/1.0");
      await h.asSuper();
      h.check("and that read is on the audit trail", (await db.query(`select count(*)::int as n from public.audit_log where table_name = 'legal_acceptances' and changed ->> 'event' = 'address_and_device_read'`)).rows[0].n === 1);
    },
  },
};
