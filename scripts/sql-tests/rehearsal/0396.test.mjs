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
      h.check("each coach with clients is left to choose, and no organization was created", closed.still_to_choose >= 2, JSON.stringify(closed));
      await h.asSuper();
      h.check("the closing coach's client is exactly where it was", (await db.query(`select organization_id from public.groups where id = $1`, [closeG])).rows[0].organization_id === org && (await seat(closeG, c4)));
      h.check("organizations created across the whole test: only the one the server made", (await db.query(`select count(*)::int as n from public.organizations`)).rows[0].n === orgsBefore + 1);
    },
  },
};
