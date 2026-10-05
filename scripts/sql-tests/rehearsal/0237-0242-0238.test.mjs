// 0237/0242: join_group_with_invite is bound to a real code (expiry, role, one-on-one limit, revoked links). 0238 (applied last, after the invite
// page calls the function) removes the loose direct-insert path. Before 0238 the old path must still work, so the deployed code keeps joining.
export default {
  name: "invite links: join_group_with_invite, revoked links, closing the loose self-join",
  migrations: ["0237", "0242", "0238"],
  phases: {
    async "0242"({ db, h, state }) {
      const coach = await h.user("Inv Coach");
      const org = await h.org(coach);
      const team = await h.group(org, coach, "team", "Team");
      const solo = await h.group(org, coach, "one_on_one", "Solo");
      Object.assign(state, { coach, org, team, solo });
      const invite = async (group, code, role = "athlete", expires = "now() + interval '7 days'") => {
        await h.asSuper();
        await db.query(`insert into public.group_invites (group_id, code, created_by, role, expires_at) values ($1, $2, $3, $4, ${expires})`, [group, code, coach, role]);
      };
      await invite(team, "TEAMCODE");
      await invite(team, "COACHCODE", "coach");
      await invite(team, "OLDCODE", "athlete", "now() - interval '1 day'");
      await invite(team, "REVOKED");
      await h.asSuper();
      await db.query(`update public.group_invites set revoked_at = now(), revoked_by = $1 where code = 'REVOKED'`, [coach]);
      await invite(solo, "SOLOCODE");

      const join = async (uid, code) => { await h.as(uid); return (await h.one(`select public.join_group_with_invite($1) as g`, [code])).g; };
      const isMember = async (g, uid) => { await h.asSuper(); return (await h.one(`select role from public.group_memberships where group_id = $1 and profile_id = $2`, [g, uid]))?.role ?? null; };

      const ann = await h.user("Ann J");
      h.check("a valid code adds the person as an athlete and returns the group", (await join(ann, "TEAMCODE")) === team && (await isMember(team, ann)) === "athlete");
      h.check("joining again with the same code is harmless and returns the group", (await join(ann, "TEAMCODE")) === team);

      const bo = await h.user("Bo J");
      await h.expectError("an expired code is refused", () => join(bo, "OLDCODE"), /invite_expired/);
      await h.expectError("a cancelled (revoked) code is refused", () => join(bo, "REVOKED"), /invite_invalid/);
      await h.expectError("a code that grants coach is refused (self-join only ever grants athlete)", () => join(bo, "COACHCODE"), /invite_invalid/);
      await h.expectError("an unknown code is refused", () => join(bo, "NOPE"), /invite_invalid/);
      h.check("none of those refusals added a membership", (await isMember(team, bo)) === null);
      await h.as(null);
      await h.expectError("a signed-out visitor cannot call the function", () => db.query(`select public.join_group_with_invite('TEAMCODE')`), /permission denied|not_signed_in/i);

      // one-on-one limit
      const cy = await h.user("Cy J");
      const di = await h.user("Di J");
      h.check("the first person to use a one-on-one link gets in", (await join(cy, "SOLOCODE")) === solo);
      await h.expectError("a second person using the same one-on-one link is refused", () => join(di, "SOLOCODE"), /invite_used/);
      await h.asSuper();
      await h.expectError("the database itself refuses a second client in a one-on-one group", () => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [solo, di]), /already has a client/i);

      // landing-page lookup reflects revoked / used
      await h.as(null);
      const info = async (code) => (await h.one(`select valid from public.get_invite_info($1)`, [code]))?.valid;
      h.check("get_invite_info: a live link is valid", (await info("TEAMCODE")) === true);
      h.check("get_invite_info: a revoked link is not valid", (await info("REVOKED")) === false);
      h.check("get_invite_info: an expired link is not valid", (await info("OLDCODE")) === false);
      h.check("get_invite_info: a one-on-one link that already has a client is not valid", (await info("SOLOCODE")) === false);
      await h.asSuper();
      h.check("has_valid_group_invite is true while a live link exists", (await h.one(`select public.has_valid_group_invite($1) as v`, [team])).v === true);
      await db.query(`update public.group_invites set revoked_at = now() where group_id = $1 and code = 'TEAMCODE'`, [team]);
      await db.query(`update public.group_invites set expires_at = now() - interval '1 hour' where group_id = $1 and code <> 'TEAMCODE'`, [team]);
      h.check("...and false once every link in the group is revoked or expired", (await h.one(`select public.has_valid_group_invite($1) as v`, [team])).v === false);
      await db.query(`update public.group_invites set revoked_at = null where code = 'TEAMCODE'`);

      // the OLD path, still open until 0238: a signed-in person inserts themselves into a group that has any live invite
      const ed = await h.user("Ed J");
      await h.as(ed);
      let oldPathWorks = true;
      try { await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [team, ed]); } catch { oldPathWorks = false; }
      h.check("before 0238 the old direct-insert join still works, so already-deployed code keeps joining", oldPathWorks);
      state.ed = ed;
    },

    async "0238"({ db, h, state }) {
      const { coach, org, team } = state;
      await h.asSuper();
      await db.query(`delete from public.group_memberships where group_id = $1 and profile_id = $2`, [team, state.ed]);
      await db.query(`update public.group_invites set revoked_at = null, expires_at = now() + interval '7 days' where code = 'TEAMCODE'`);
      const fay = await h.user("Fay J");
      await h.as(fay);
      await h.expectError("after 0238 a person can no longer insert themselves into a group, even one with a live invite", () => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [team, fay]), /row-level security/i);
      const joined = (await h.one(`select public.join_group_with_invite('TEAMCODE') as g`)).g;
      await h.asSuper();
      h.check("after 0238 joining through the invite function still works", joined === team && !!(await h.one(`select 1 as x from public.group_memberships where group_id = $1 and profile_id = $2`, [team, fay])));
      const gus = await h.user("Gus J");
      await h.as(coach);
      let ok = true;
      try { await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [team, gus]); } catch { ok = false; }
      h.check("after 0238 a coach can still add a person to their group", ok);
      const other = await h.user("Other Coach");
      const otherOrg = await h.org(other);
      await h.group(otherOrg, other, "team", "Elsewhere");
      const hal = await h.user("Hal J");
      await h.as(other);
      await h.expectError("a coach of another group cannot add people to this group", () => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'athlete')`, [team, hal]), /row-level security/i);
      const admin = await h.user("Org Admin");
      await h.orgMember(org, admin, "admin");
      await h.as(admin);
      ok = true;
      try { await db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [team, admin]); } catch { ok = false; }
      h.check("after 0238 an org admin can still add themselves as coach to a group in their org (group switcher)", ok);
      const ivy = await h.user("Ivy J");
      await h.as(ivy);
      await h.expectError("...but a non-member cannot add themselves as coach", () => db.query(`insert into public.group_memberships (group_id, profile_id, role) values ($1, $2, 'coach')`, [team, ivy]), /row-level security/i);
    },
  },
};
