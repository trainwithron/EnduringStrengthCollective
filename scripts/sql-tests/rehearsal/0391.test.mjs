// 0391: getting out of an organization. Remove a member (clients only they coach go to a named member; a client private from the organization leaves with their coach), leave, change a role, cancel or extend an
// invitation, and close the organization.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0391 Offboarding",
  migrations: ["0391"],
  phases: {
    async "0391"({ db, h }) {
      const owner = await h.user("OB Owner");
      const admin = await h.user("OB Admin");
      const c1 = await h.user("OB Coach One");
      const c2 = await h.user("OB Coach Two");
      const outsider = await h.user("OB Outsider");
      const k1 = await h.user("OB Client One");
      const k2 = await h.user("OB Client Private");
      const k3 = await h.user("OB Client Team");
      const k4 = await h.user("OB Client Two");
      const org = await h.org(owner, "OB Gym");
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, c1, "coach");
      await h.orgMember(org, c2, "coach");
      const teamG = await h.group(org, c1, "team", "OB team");
      await h.member(teamG, c2, "coach");
      await h.member(teamG, k3);
      const oneG = await h.group(org, c1, "one_on_one", "OB one on one");
      await h.member(oneG, k1);
      const privG = await h.group(org, c1, "one_on_one", "OB private");
      await h.member(privG, k2);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [privG, k2]);
      const emptyG = await h.group(org, c1, "team", "OB empty");
      await h.asSuper();
      await db.query(`insert into public.session_types (organization_id, coach_id, name) values ($1, $2, 'OB session type')`, [org, c1]);
      await db.query(`insert into public.pro_shop_links (organization_id, coach_id, title, url) values ($1, $2, 'OB link', 'https://example.com')`, [org, c1]);
      await db.query(`insert into public.group_sessions (organization_id, coach_id, kind, capacity, title, start_at, end_at) values ($1, $2, 'class', 8, 'OB class', now() + interval '2 days', now() + interval '2 days 1 hour')`, [org, c1]);
      await db.query(`insert into public.group_sessions (organization_id, coach_id, group_id, kind, title, start_at, end_at) values ($1, $2, $3, 'event', 'OB gym event', now() + interval '2 days', now() + interval '2 days 1 hour')`, [org, c1, teamG]);
      // a future confirmed booking of c1 with k1
      await db.query(`insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status) values ($1, $2, $3, now() + interval '3 days', now() + interval '3 days 1 hour', 'confirmed')`, [c1, k1, oneG]);
      const inv = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, created_by, expires_at) values ($1, $2, 'coach', $3, now() + interval '1 day') returning id`, [org, outsider, owner])).rows[0].id;

      // ---- who may do what
      await h.as(c2);
      let r = await tryQ(db, `select public.remove_org_member($1, $2, null)`, [org, c1]);
      h.check("a plain coach cannot remove a member", /Only an owner or admin/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'admin')`, [org, c2]);
      h.check("a plain coach cannot change a role", /Only an owner or admin/.test(r.error ?? ""), r.error);
      await h.as(admin);
      r = await tryQ(db, `select public.remove_org_member($1, $2, null)`, [org, owner]);
      h.check("the owner cannot be removed", /owner cannot be removed/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'admin')`, [org, c2]);
      h.check("an admin cannot make someone an admin", /Only the owner can/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.remove_org_member($1, $2, $3)`, [org, c1, outsider]);
      h.check("clients can only be handed to a member of the organization", /another member/.test(r.error ?? ""), r.error);

      // handing a group's clients to a person who is a client of that group would leave it with no coach: refused
      const hostile = await h.user("OB Client Who Is Also Staff");
      await h.orgMember(org, hostile, "coach");
      const zTeam = await h.group(org, c1, "team", "OB zteam");
      await h.member(zTeam, hostile);
      await h.as(admin);
      r = await tryQ(db, `select public.remove_org_member($1, $2, $3)`, [org, c1, hostile]);
      h.check("the person taking over cannot be a client of the group handed to them", /is a client in/.test(r.error ?? ""), r.error);
      await h.asSuper();
      await db.query(`delete from public.groups where id = $1`, [zTeam]);
      await db.query(`delete from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, hostile]);
      await h.as(admin);

      // ---- remove c1: refused until someone is named, because they alone coach a client
      r = await tryQ(db, `select public.remove_org_member($1, $2, null)`, [org, c1]);
      h.check("removing a coach who alone coaches a client asks who takes over", /Choose who takes over 1 client first/.test(r.error ?? ""), r.error);
      await h.asSuper();
      const stillThere = await db.query(`select count(*)::int as n from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, c1]);
      h.check("a refused removal changes nothing", stillThere.rows[0].n === 1);

      await h.as(admin);
      r = await tryQ(db, `select public.remove_org_member($1, $2, $3) as res`, [org, c1, c2]);
      h.check("an admin removes a coach and hands the client to another member" + (r.error ? ": " + r.error : ""), !r.error);
      const res = r.rows?.[0]?.res ?? {};
      h.check("it says what it did (1 group handed over, 1 group taken along)", res.handed === 1 && res.taken === 1, JSON.stringify(res));
      await h.asSuper();
      const seats = await db.query(`select group_id, profile_id from public.group_memberships where role = 'coach' and group_id in ($1, $2, $3, $4)`, [teamG, oneG, privG, emptyG]);
      const seat = (g, p) => seats.rows.some((s) => s.group_id === g && s.profile_id === p);
      h.check("the shared team keeps its other coach and the removed coach lost their seat", seat(teamG, c2) && !seat(teamG, c1));
      h.check("the one-on-one space now has the new coach, with the client and their history in place", seat(oneG, c2) && !seat(oneG, c1) && (await db.query(`select 1 from public.group_memberships where group_id = $1 and profile_id = $2 and role = 'athlete'`, [oneG, k1])).rows.length === 1);
      h.check("the empty group lost the coach's seat and stays", !seat(emptyG, c1));
      h.check("the removed coach is no longer a member", (await db.query(`select 1 from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, c1])).rows.length === 0);
      const priv = (await db.query(`select organization_id from public.groups where id = $1`, [privG])).rows[0];
      h.check("the client who is private from the organization left with their coach, into an organization of their own", priv.organization_id !== org && seat(privG, c1));
      const solo = (await db.query(`select owner_id from public.organizations where id = $1`, [priv.organization_id])).rows[0];
      h.check("that new organization is owned by the coach", solo?.owner_id === c1);
      const filed = async (table) => (await db.query(`select organization_id from public.${table} where coach_id = $1 limit 1`, [c1])).rows[0]?.organization_id;
      h.check("the coach who left with a client took their session types and shop links into their own organization", (await filed("session_types")) === priv.organization_id && (await filed("pro_shop_links")) === priv.organization_id);
      h.check("their class went with them, and the event of a group that stayed with the gym did not", (await db.query(`select title, organization_id from public.group_sessions where coach_id = $1 order by title`, [c1])).rows.map((x) => x.title + ":" + (x.organization_id === priv.organization_id ? "moved" : "stayed")).join() === "OB class:moved,OB gym event:stayed");
      const bk = (await db.query(`select coach_id from public.bookings where group_id = $1`, [oneG])).rows[0];
      h.check("their future booking moved to the new coach", bk.coach_id === c2);
      const au = (await db.query(`select count(*)::int as n from public.audit_log where table_name = 'organization_memberships' and changed ->> 'event' = 'remove_member'`)).rows[0];
      h.check("the removal is on the audit trail", au.n >= 1);

      // ---- roles
      await h.as(owner);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'admin')`, [org, c2]);
      h.check("the owner makes a coach an admin", !r.error, r.error);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'owner')`, [org, c2]);
      h.check("ownership is handed over, never assigned", /admin or coach/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.set_org_member_role($1, $2, 'coach')`, [org, owner]);
      h.check("the owner's role cannot be changed", /owner/.test(r.error ?? ""), r.error);
      await h.asSuper();
      h.check("the role changed", (await db.query(`select role from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, c2])).rows[0].role === "admin");

      // ---- invitations
      await h.as(c2);
      await h.as(admin);
      r = await tryQ(db, `select public.extend_org_invite($1) as until`, [inv]);
      h.check("an admin gives an invitation fourteen more days", !r.error && new Date(r.rows[0].until) > new Date(Date.now() + 13 * 86400000), JSON.stringify(r));
      await h.as(outsider);
      r = await tryQ(db, `select public.cancel_org_invite($1)`, [inv]);
      h.check("the invited person cannot cancel it for the organization", !!r.error);
      await h.as(admin);
      r = await tryQ(db, `select public.cancel_org_invite($1)`, [inv]);
      h.check("an admin cancels an open invitation", !r.error, r.error);
      r = await tryQ(db, `select public.cancel_org_invite($1)`, [inv]);
      h.check("a cancelled invitation cannot be cancelled again", /already been answered/.test(r.error ?? ""), r.error);

      // ---- leaving, then closing
      const lone = await h.user("OB Leaver");
      await h.orgMember(org, lone, "coach");
      await h.as(owner);
      r = await tryQ(db, `select public.leave_organization($1)`, [org]);
      h.check("the owner cannot leave", /owner cannot leave/.test(r.error ?? ""), r.error);
      await h.as(lone);
      r = await tryQ(db, `select public.leave_organization(p_org => $1) as res`, [org]);
      h.check("a coach with no clients leaves with the one-argument call" + (r.error ? ": " + r.error : ""), !r.error);

      // c2 is now an admin who alone coaches a group with a client
      const soloG = await h.group(org, c2, "one_on_one", "OB c2 one on one");
      await h.member(soloG, k4);
      await h.member(teamG, owner, "coach"); // the owner also coaches the shared team
      const inv2 = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, created_by) values ($1, $2, 'coach', $3) returning id`, [org, outsider, owner])).rows[0].id;
      await h.as(admin);
      r = await tryQ(db, `select public.close_organization($1)`, [org]);
      h.check("only the owner can close the organization", /Only the owner/.test(r.error ?? ""), r.error);
      await h.as(owner);
      r = await tryQ(db, `select public.close_organization($1) as res`, [org]);
      h.check("the owner closes the organization" + (r.error ? ": " + r.error : ""), !r.error);
      await h.asSuper();
      const left = await db.query(`select profile_id from public.organization_memberships where organization_id = $1`, [org]);
      h.check("only the owner is left in it", left.rows.length === 1 && left.rows[0].profile_id === owner, JSON.stringify(left.rows));
      const sg = (await db.query(`select organization_id from public.groups where id = $1`, [soloG])).rows[0];
      h.check("each member took the clients they alone coach into an organization of their own", sg.organization_id !== org && (await db.query(`select owner_id from public.organizations where id = $1`, [sg.organization_id])).rows[0].owner_id === c2);
      h.check("a shared group stays with the owner's organization and the open invitation is cancelled", (await db.query(`select organization_id from public.groups where id = $1`, [teamG])).rows[0].organization_id === org && (await db.query(`select answered_at from public.organization_invites where id = $1`, [inv2])).rows[0].answered_at != null);
    },
  },
};
