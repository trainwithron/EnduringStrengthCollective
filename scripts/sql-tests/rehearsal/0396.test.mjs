// 0396: a leaving coach is never given an organization; their private clients stay where they are, they are marked leaving, and complete_departure (server only) is what moves them once they choose.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0396 Leaving coach choice",
  migrations: ["0396"],
  phases: {
    async "0396"({ db, h }) {
      const owner = await h.user("LC Owner");
      const c1 = await h.user("LC Leaving Coach");
      const c2 = await h.user("LC Other Coach");
      const kGym = await h.user("LC Gym Client");
      const kPriv = await h.user("LC Private Client");
      const org = await h.org(owner, "LC Gym");
      await h.orgMember(org, c1, "admin");
      await h.orgMember(org, c2, "coach");
      const gymG = await h.group(org, c1, "one_on_one", "LC gym client");
      await h.member(gymG, kGym);
      const privG = await h.group(org, c1, "one_on_one", "LC private client");
      await h.member(privG, kPriv);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [privG, kPriv]);
      await db.query(`insert into public.session_types (organization_id, coach_id, name) values ($1, $2, 'LC type')`, [org, c1]);
      let orgsBefore = (await db.query(`select count(*)::int as n from public.organizations`)).rows[0].n;

      // ---- the owner removes the coach
      await h.as(owner);
      let r = await tryQ(db, `select public.remove_org_member($1, $2, $3) as res`, [org, c1, c2]);
      h.check("removing a coach whose client is private from the gym works" + (r.error ? ": " + r.error : ""), !r.error);
      const res = r.rows?.[0]?.res ?? {};
      h.check("it says one group was handed over, one kept, and that the coach is leaving", res.handed === 1 && res.kept === 1 && res.leaving === true, JSON.stringify(res));
      await h.asSuper();
      h.check("NO organization was created", (await db.query(`select count(*)::int as n from public.organizations`)).rows[0].n === orgsBefore);
      const seat = (g, p) => db.query(`select 1 from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'coach'`, [g, p]).then((x) => x.rows.length === 1);
      h.check("the gym's client went to the named coach", (await seat(gymG, c2)) && !(await seat(gymG, c1)));
      h.check("the private client stayed with their coach, in the same group, in the same organization", (await seat(privG, c1)) && (await db.query(`select organization_id from public.groups where id = $1`, [privG])).rows[0].organization_id === org);
      const mem = (await db.query(`select role, departing_since from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, c1])).rows[0];
      h.check("the coach's membership is kept, marked leaving, and an admin is back to coach", mem?.departing_since != null && mem.role === "coach", JSON.stringify(mem));
      h.check("their session type is still where it was", (await db.query(`select organization_id from public.session_types where coach_id = $1`, [c1])).rows[0].organization_id === org);

      // ---- a leaving coach is NOT a member for anything organization-wide (prospects' contact details, the roster, seats, tags), but still sees their own row and their own kept client
      await h.asSuper();
      await db.query(`insert into public.org_trainer_dispatch_requests (organization_id, prospect_name, prospect_email, prospect_timezone, requested_start_at, goal_type) values ($1, 'Pat Prospect', 'pat@example.com', 'UTC', now(), 'weight_loss')`, [org]);
      const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
      await h.as(c2);
      h.check("an ordinary coach of the gym reads the prospects", (await count(`select count(*)::int as n from public.org_trainer_dispatch_requests where organization_id = $1`, [org])) === 1);
      h.check("an ordinary coach is a member", (await count(`select public.is_org_member($1)::int as n`, [org])) === 1);
      await h.as(c1);
      h.check("the leaving coach reads NO prospects", (await count(`select count(*)::int as n from public.org_trainer_dispatch_requests where organization_id = $1`, [org])) === 0);
      h.check("the leaving coach is not a member of the organization", (await count(`select public.is_org_member($1)::int as n`, [org])) === 0);
      h.check("the leaving coach cannot read the roster, only their own row", (await count(`select count(*)::int as n from public.organization_memberships where organization_id = $1`, [org])) === 1);
      r = await tryQ(db, `select public.org_coach_seats($1)`, [org]);
      h.check("nor the seat count", !!r.error);
      h.check("their own kept client is still theirs to see", (await count(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2`, [privG, kPriv])) === 1);
      await h.as(owner);
      h.check("the gym's seat count no longer includes the leaving coach", (await count(`select public.org_coach_seats($1)::int as n`, [org])) === 2);
      const billable = await count(`select public.org_billable_clients($1)::int as n`, [org]);
      await h.asSuper();
      const everyone = await count(`select count(distinct m.profile_id)::int as n from public.groups g join public.group_memberships m on m.group_id = g.id where g.organization_id = $1 and m.role = 'athlete' and m.membership_type = 'training'`, [org]);
      h.check("the gym is not billed for the clients of the groups the leaving coach kept", billable === everyone - 1, billable + " vs " + everyone);
      await h.as(owner);

      // ---- nobody can hand clients to, make owner, or promote a leaving coach
      const c5 = await h.user("LC Sole Coach");
      const kSole = await h.user("LC Sole Client");
      await h.orgMember(org, c5, "coach");
      const soleG = await h.group(org, c5, "one_on_one", "LC gym-owned client");
      await h.member(soleG, kSole);
      await h.as(owner);
      r = await tryQ(db, `select public.remove_org_member($1, $2, $3)`, [org, c5, c1]);
      h.check("a leaving coach is refused as the one who takes over", /leaving/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.transfer_organization_ownership($1, $2)`, [org, c1]);
      h.check("a leaving coach cannot be made the owner", /leaving/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'admin')`, [org, c1]);
      h.check("nor made an admin", /leaving/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.assign_group_coach($1, $2, false)`, [gymG, c1]);
      h.check("nor chosen as a group's coach", /leaving/.test(r.error ?? ""), r.error);
      // the server (or the SQL editor) can still hand an organization over
      const ownerB = await h.user("LC Owner B");
      const memberB = await h.user("LC Member B");
      const orgB = await h.org(ownerB, "LC Gym B");
      orgsBefore += 1; // this test made one more organization itself
      await h.orgMember(orgB, memberB, "coach");
      await h.asService();
      r = await tryQ(db, `select public.transfer_organization_ownership($1, $2)`, [orgB, memberB]);
      h.check("a service-role transfer of ownership still works" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      h.check("and the new owner owns it", (await db.query(`select owner_id from public.organizations where id = $1`, [orgB])).rows[0].owner_id === memberB);
      await h.as(owner);
      r = await tryQ(db, `select public.remove_org_member($1, $2, $3) as res`, [org, c5, c2]);
      h.check("the gym's own client still goes to a coach who is staying", !r.error);

      // ---- nothing happens by itself; only the server can finish it
      await h.as(c1);
      r = await tryQ(db, `select public.complete_departure($1, $2)`, [org, c1]);
      h.check("the coach cannot finish the departure themselves", !!r.error);
      await h.as(owner);
      r = await tryQ(db, `select public.complete_departure($1, $2)`, [org, c1]);
      h.check("nor can the owner", !!r.error);
      await h.asSuper();
      const gymG2 = await h.group(org, c2, "one_on_one", "LC gym-owned group the leaving coach ended up alone in");
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [gymG2, c1]);
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [gymG2, c2]);
      await h.asService();
      r = await tryQ(db, `select public.complete_departure($1, $2) as res`, [org, owner]);
      h.check("it refuses the organization's owner", !!r.error);
      r = await tryQ(db, `select public.complete_departure($1, $2) as res`, [org, c2]);
      h.check("it refuses a coach who is not leaving", /not leaving/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.complete_departure($1, $2) as res`, [org, c1]);
      h.check("the server finishes it once they have chosen" + (r.error ? ": " + r.error : ""), !r.error);
      const done = r.rows?.[0]?.res ?? {};
      await h.asSuper();
      const newOrg = (await db.query(`select owner_id from public.organizations where id = $1`, [done.organization_id])).rows[0];
      h.check("the coach now owns an organization", newOrg?.owner_id === c1);
      h.check("their private client's space moved into it, with the coach still in it", (await db.query(`select organization_id from public.groups where id = $1`, [privG])).rows[0].organization_id === done.organization_id && (await seat(privG, c1)));
      h.check("the gym's client did NOT move", (await db.query(`select organization_id from public.groups where id = $1`, [gymG])).rows[0].organization_id === org);
      h.check("nor did a gym group the leaving coach was alone in (only the groups they kept move)", (await db.query(`select organization_id from public.groups where id = $1`, [gymG2])).rows[0].organization_id === org);
      h.check("a second call finds nothing to do and makes no second organization", await (async () => {
        await h.asService();
        const again = await tryQ(db, `select public.complete_departure($1, $2)`, [org, c1]);
        await h.asSuper();
        return !!again.error;
      })());
      h.check("their session type moved with them", (await db.query(`select organization_id from public.session_types where coach_id = $1`, [c1])).rows[0].organization_id === done.organization_id);
      h.check("they are no longer in the old organization", (await db.query(`select 1 from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, c1])).rows.length === 0);

      // ---- leaving by yourself and closing the team follow the same rule
      const c3 = await h.user("LC Self Leaver");
      const kSelf = await h.user("LC Self Client");
      await h.orgMember(org, c3, "coach");
      const selfG = await h.group(org, c3, "one_on_one", "LC self leaver client");
      await h.member(selfG, kSelf);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [selfG, kSelf]);
      await h.as(c3);
      r = await tryQ(db, `select public.leave_organization(p_org => $1) as res`, [org]);
      h.check("a coach with a private client can leave, and is then leaving, with no organization made" + (r.error ? ": " + r.error : ""), !r.error && r.rows[0].res.leaving === true);
      await h.asSuper();
      h.check("still no extra organization", (await db.query(`select count(*)::int as n from public.organizations`)).rows[0].n === orgsBefore + 1);

      const c4 = await h.user("LC Closing Coach");
      const kClose = await h.user("LC Closing Client");
      await h.orgMember(org, c4, "coach");
      const closeG = await h.group(org, c4, "one_on_one", "LC closing client");
      await h.member(closeG, kClose);
      await h.as(owner);
      r = await tryQ(db, `select public.close_organization($1) as res`, [org]);
      h.check("the owner closes the team" + (r.error ? ": " + r.error : ""), !r.error);
      const closed = r.rows?.[0]?.res ?? {};
      h.check("only coaches who keep clients private from the team are left to choose (the rest go to the owner), and no organization was created", closed.still_to_choose >= 1 && closed.still_to_choose < closed.members_left, JSON.stringify(closed));
      await h.asSuper();
      h.check("a closing coach's gym-visible client stays in the gym and goes to the owner, not left with the coach", (await db.query(`select organization_id from public.groups where id = $1`, [closeG])).rows[0].organization_id === org && (await seat(closeG, owner)) && !(await seat(closeG, c4)));
      h.check("organizations created across the whole test: only the one the server made", (await db.query(`select count(*)::int as n from public.organizations`)).rows[0].n === orgsBefore + 1);

      // the stored exports bucket is private and has no storage policy at all (only the server key reaches it)
      h.check("the exports bucket exists and is private", (await count(`select count(*)::int as n from storage.buckets where id = 'coach-exit-exports' and public = false`)) === 1);
      h.check("and no storage policy mentions it", (await count(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%coach-exit-exports%'`)) === 0);

      // ================= quit (seven days) and fired (at once), in an organization of their own
      const o2 = await h.user("LD Owner");
      const quitter = await h.user("LD Quitter");
      const fired = await h.user("LD Fired");
      const kQ = await h.user("LD Quitter Client");
      const kF = await h.user("LD Fired Client");
      const admin = await h.user("LD Platform Admin");
      const org2 = await h.org(o2, "LD Gym");
      await h.orgMember(org2, quitter, "coach");
      await h.orgMember(org2, fired, "coach");
      const gQ = await h.group(org2, quitter, "one_on_one", "LD quitter client");
      await h.member(gQ, kQ);
      const gF = await h.group(org2, fired, "one_on_one", "LD fired client");
      await h.member(gF, kF);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where (group_id = $1 and profile_id = $2) or (group_id = $3 and profile_id = $4)`, [gQ, kQ, gF, kF]);
      await db.query(`update public.profiles set is_platform_admin = true where id = $1`, [admin]);
      const orgsAfterSetup = await count(`select count(*)::int as n from public.organizations`);

      // QUIT: the owner says they are leaving on good terms -> seven days
      await h.as(o2);
      r = await tryQ(db, `select public.remove_org_member($1, $2, null, false) as res`, [org2, quitter]);
      h.check("the owner removes a coach who is leaving on good terms" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      let qm = (await db.query(`select fired_at, access_ended_at, departing_since from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org2, quitter])).rows[0];
      h.check("the organization's name is remembered on the row", (await count(`select count(*)::int as n from public.organization_memberships where organization_id = $1 and profile_id = $2 and departing_org_name = 'LD Gym'`, [org2, quitter])) === 1);
      h.check("the quitter is leaving, not let go, and keeps coaching", qm.departing_since != null && qm.fired_at == null && qm.access_ended_at == null && (await seat(gQ, quitter)));
      await h.asService();
      r = await tryQ(db, `select public.end_departure_access($1, $2) as ended`, [org2, quitter]);
      h.check("on day zero the server does not end their access", r.rows?.[0]?.ended === false, JSON.stringify(r));
      await h.asSuper();
      await db.query(`update public.organization_memberships set departing_since = now() - interval '8 days' where organization_id = $1 and profile_id = $2`, [org2, quitter]);
      await h.as(quitter);
      r = await tryQ(db, `select public.end_departure_access($1, $2)`, [org2, quitter]);
      h.check("the coach cannot end their own window", !!r.error);
      await h.asService();
      r = await tryQ(db, `select public.end_departure_access($1, $2) as ended`, [org2, quitter]);
      h.check("after seven days the server ends their coaching access", r.rows?.[0]?.ended === true, JSON.stringify(r));
      await h.asSuper();
      h.check("their seat is gone, their client and the record of the group are exactly where they were", !(await seat(gQ, quitter)) && (await count(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [gQ, kQ])) === 1 && (await db.query(`select organization_id from public.groups where id = $1`, [gQ])).rows[0].organization_id === org2);
      await h.asService();
      r = await tryQ(db, `select public.end_departure_access($1, $2) as ended`, [org2, quitter]);
      h.check("a second run does nothing", r.rows?.[0]?.ended === false);
      r = await tryQ(db, `select public.complete_departure($1, $2)`, [org2, quitter]);
      h.check("and they can no longer start their own account here", /seven days/.test(r.error ?? ""), r.error);

      // FIRED: coaching access ends at once, and they cannot start their own account
      await h.as(o2);
      r = await tryQ(db, `select public.remove_org_member($1, $2, null, true) as res`, [org2, fired]);
      h.check("the owner lets a coach go" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      const fm = (await db.query(`select fired_at, access_ended_at from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org2, fired])).rows[0];
      h.check("they are marked let go, and their access ended at once", fm.fired_at != null && fm.access_ended_at != null && !(await seat(gF, fired)));
      h.check("their client is untouched", (await count(`select count(*)::int as n from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [gF, kF])) === 1);
      await h.asService();
      r = await tryQ(db, `select public.complete_departure($1, $2)`, [org2, fired]);
      h.check("a coach who was let go cannot start their own account", /let go/.test(r.error ?? ""), r.error);
      await h.as(o2);
      r = await tryQ(db, `select public.lift_departure_block($1, $2)`, [org2, fired]);
      h.check("the owner cannot lift it", !!r.error);
      await h.as(admin);
      r = await tryQ(db, `select public.lift_departure_block($1, $2)`, [org2, fired]);
      h.check("a platform administrator can" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      h.check("the coach's seat is back and the block is gone", (await seat(gF, fired)) && (await db.query(`select fired_at, access_ended_at from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org2, fired])).rows[0].fired_at == null);

      // A quitter within the window starts their own account: the organization has no billing row, so it is on the standard trial
      await h.asService();
      r = await tryQ(db, `select public.complete_departure($1, $2) as res`, [org2, fired]);
      h.check("then they can start their own account" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      h.check("exactly one organization was made, and it has no billing row (the standard trial from its start)", (await count(`select count(*)::int as n from public.organizations`)) === orgsAfterSetup + 1 && (await count(`select count(*)::int as n from public.organization_billing where organization_id = $1`, [r.rows[0].res.organization_id])) === 0);

      // ================= third-round rules: a let-go coach stays recorded, loses the rows filed under their name, and the gym is billed fairly
      const fired2 = await h.user("LD Fired Two");
      const kF2 = await h.user("LD Fired Two Client");
      const late = await h.user("LD Late Quitter");
      const kLate = await h.user("LD Late Client");
      await h.orgMember(org2, fired2, "coach");
      await h.orgMember(org2, late, "coach");
      const gF2 = await h.group(org2, fired2, "one_on_one", "LD fired two client");
      await h.member(gF2, kF2);
      const gLate = await h.group(org2, late, "one_on_one", "LD late client");
      await h.member(gLate, kLate);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where (group_id = $1 and profile_id = $2) or (group_id = $3 and profile_id = $4)`, [gF2, kF2, gLate, kLate]);
      await h.as(o2);
      r = await tryQ(db, `select public.remove_org_member($1, $2, null, true)`, [org2, fired2]);
      h.check("another coach is let go", !r.error, r.error);
      r = await tryQ(db, `select public.remove_org_member($1, $2, null, true)`, [org2, fired2]);
      h.check("removing them a second time changes nothing and is not an error", !r.error, r.error);
      r = await tryQ(db, `select public.close_organization($1)`, [org2]);
      h.check("closing the organization does not wipe them either", !r.error, r.error);
      await h.asSuper();
      const keep = (await db.query(`select fired_at, access_ended_at, departing_group_ids from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org2, fired2])).rows[0];
      h.check("they are still recorded as let go, with their kept group", keep && keep.fired_at != null && keep.access_ended_at != null && keep.departing_group_ids.includes(gF2), JSON.stringify(keep));
      await h.as(fired2);
      h.check("what they filed under their own name is no longer theirs to write (coach_in_org is false)", (await count(`select public.coach_in_org($1)::int as n`, [org2])) === 0);
      await h.as(late);
      h.check("a coach still inside their days keeps it (coach_in_org true)", (await count(`select public.coach_in_org($1)::int as n`, [org2])) === 1);

      // the gym is not billed for a group with no coach; it is billed again once a different coach holds it
      await h.asService();
      const before = await count(`select public.org_billable_clients($1)::int as n`, [org2]);
      await h.asSuper();
      await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [gF2, o2]);
      await h.asService();
      const after = await count(`select public.org_billable_clients($1)::int as n`, [org2]);
      await h.asSuper();
      h.check("a kept group is billable to the gym again once a different coach holds it", after === before + 1, before + " -> " + after);

      // the seven days are enforced by the clock when starting an account, not only by the daily job
      await db.query(`update public.organization_memberships set departing_since = now() - interval '8 days' where organization_id = $1 and profile_id = $2`, [org2, late]);
      await h.as(late);
      await h.asService();
      r = await tryQ(db, `select public.complete_departure($1, $2)`, [org2, late]);
      h.check("past seven days a coach cannot start an account even if the job has not run yet", /seven days/.test(r.error ?? ""), r.error);

      // closing a team whose owner is a client in a group a coach solely coaches does not fail: the coach keeps that group
      const o3 = await h.user("LE Owner");
      const e3 = await h.user("LE Coach");
      const org3 = await h.org(o3, "LE Gym");
      await h.orgMember(org3, e3, "coach");
      const g3 = await h.group(org3, e3, "one_on_one", "LE owner is a client");
      await h.member(g3, o3);
      await h.as(o3);
      r = await tryQ(db, `select public.close_organization($1) as res`, [org3]);
      h.check("closing a team whose owner is a client in the coach's group does not fail" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      h.check("the coach keeps that group until the owner picks someone", await seat(g3, e3));
    },
  },
};
