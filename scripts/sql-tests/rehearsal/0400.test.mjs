// 0400: the front desk. A person invited to the front desk is NOT an organization member and holds no group seat; they can find a client by name and check them in, and see nothing else.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0400 Front desk",
  migrations: ["0400"],
  phases: {
    async "0400"({ db, h }) {
      const owner = await h.user("FD Owner");
      const admin = await h.user("FD Admin");
      const coach = await h.user("FD Coach");
      const desk = await h.user("FD Desk Person");
      const desk2 = await h.user("FD Second Desk");
      const otherOwner = await h.user("FD Other Owner");
      const otherDesk = await h.user("FD Other Desk");
      const ann = await h.user("Ann Anderson");
      const anders = await h.user("Anders Private");
      const social = await h.user("Anna Social");
      const retired = await h.user("Anya Retired");
      const elsewhere = await h.user("Annie Elsewhere");
      const org = await h.org(owner, "FD Gym");
      const org2 = await h.org(otherOwner, "FD Other Gym");
      await h.orgMember(org, admin, "admin");
      await h.orgMember(org, coach, "coach");

      const gAnn = await h.group(org, coach, "one_on_one", "FD Ann");
      await h.member(gAnn, ann);
      const gPriv = await h.group(org, coach, "one_on_one", "FD Private");
      await h.member(gPriv, anders);
      const coach2 = await h.user("FD Second Coach");
      await h.orgMember(org, coach2, "coach");
      const gSocial = await h.group(org, coach, "team", "FD Social group");
      await h.member(gSocial, social);
      const gRetired = await h.group(org, coach, "team", "FD Retired season");
      await h.member(gRetired, retired);
      const gOther = await h.group(org2, otherOwner, "one_on_one", "FD Elsewhere");
      await h.member(gOther, elsewhere);
      await h.asSuper();
      await db.query(`update public.group_memberships set private_from_org = true where group_id = $1 and profile_id = $2`, [gPriv, anders]);
      await db.query(`update public.group_memberships set membership_type = 'social_only' where group_id = $1 and profile_id = $2`, [gSocial, social]);
      await db.query(`update public.groups set archived_at = now() where id = $1`, [gRetired]);
      // dates of birth: Ann is an adult, a minor and a client with no date on file are shortened
      const minor = await h.user("Anders Minorson");
      const unknownAge = await h.user("Anders Unknownson");
      const gMinor = await h.group(org, coach, "one_on_one", "FD Minor");
      await h.member(gMinor, minor);
      const gUnknown = await h.group(org, coach, "one_on_one", "FD Unknown");
      await h.member(gUnknown, unknownAge);
      await h.asSuper();
      await db.query("insert into public.client_intake (athlete_id, group_id, date_of_birth) values ($1, $2, '1990-04-01'), ($3, $4, (current_date - interval '15 years')::date)", [ann, gAnn, minor, gMinor]);
      for (const [g, a] of [[gAnn, ann], [gPriv, anders], [gOther, elsewhere]]) {
        await h.as(g === gOther ? otherOwner : coach);
        await db.query(`select public.set_kiosk_pin($1, $2, '1234')`, [g, a]);
      }
      await h.asSuper();

      // ---- the invitation: accepting makes the front-desk row and nothing else
      const inv = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, created_by) values ($1, $2, 'front_desk', $3) returning id`, [org, desk, owner])).rows[0].id;
      let r = await tryQ(db, `insert into public.organization_invites (organization_id, invited_profile_id, role, created_by) values ($1, $2, 'owner', $3)`, [org, desk2, owner]);
      h.check("an invitation can name the front desk but still not 'owner'", !!r.error);
      await h.as(desk);
      r = await tryQ(db, `select public.answer_organization_invite($1, true) as o`, [inv]);
      h.check("the invited person accepts" + (r.error ? ": " + r.error : ""), !r.error && r.rows[0].o === org);
      await h.asSuper();
      h.check("they are a front-desk person of the organization", (await db.query(`select count(*)::int as n from public.org_front_desk where organization_id = $1 and profile_id = $2`, [org, desk])).rows[0].n === 1);
      h.check("but not an organization member", (await db.query(`select count(*)::int as n from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, desk])).rows[0].n === 0);
      h.check("and they hold no group seat", (await db.query(`select count(*)::int as n from public.group_memberships where profile_id = $1`, [desk])).rows[0].n === 0);

      // ---- an ordinary invitation still works as before
      const inv2 = (await db.query(`insert into public.organization_invites (organization_id, invited_profile_id, role, created_by) values ($1, $2, 'coach', $3) returning id`, [org, desk2, owner])).rows[0].id;
      await h.as(desk2);
      await tryQ(db, `select public.answer_organization_invite($1, true)`, [inv2]);
      await h.asSuper();
      h.check("a coach invitation still makes an organization membership and no front-desk row", (await db.query(`select (select count(*)::int from public.organization_memberships where organization_id = $1 and profile_id = $2 and role = 'coach') as m, (select count(*)::int from public.org_front_desk where profile_id = $2) as f`, [org, desk2])).rows[0].m === 1);
      await db.query(`delete from public.organization_memberships where organization_id = $1 and profile_id = $2`, [org, desk2]);

      // ---- what the front-desk person can read directly: nothing
      await h.as(desk);
      for (const [label, sql] of [
        ["clients' group seats", `select count(*)::int as n from public.group_memberships`],
        ["the health forms", `select count(*)::int as n from public.client_intake`],
        ["the organization", `select count(*)::int as n from public.organizations`],
        ["the organization's members", `select count(*)::int as n from public.organization_memberships`],
        ["the groups", `select count(*)::int as n from public.groups`],
        ["the check-in codes", `select count(*)::int as n from public.kiosk_pins`],
      ]) {
        r = await tryQ(db, sql);
        h.check("a front-desk person sees none of " + label, !r.error ? r.rows[0].n === 0 : true, JSON.stringify(r));
      }
      r = await tryQ(db, `insert into public.org_front_desk (organization_id, profile_id) values ($1, $2)`, [org, otherDesk]);
      h.check("nor can they add anyone to the front desk themselves", !!r.error);
      r = await tryQ(db, `select * from public.front_desk_orgs()`);
      h.check("they see the organization they work for, by name", r.rows?.length === 1 && r.rows[0].name === "FD Gym", JSON.stringify(r));
      await h.asSuper();

      // ---- finding a client
      let v0;
      const find = async (who, orgId, q) => {
        await h.as(who);
        const x = await tryQ(db, `select * from public.front_desk_find($1, $2)`, [orgId, q]);
        await h.asSuper();
        return x;
      };
      r = await find(desk, org, "an");
      h.check("a name search finds the client with the group to check in to and whether a code is set", r.rows?.length >= 1 && r.rows.some((x) => x.athlete_id === ann && x.group_id === gAnn && x.has_pin === true), JSON.stringify(r));
      h.check("only a name, group and 'has a code' come back", Object.keys(r.rows?.[0] ?? {}).sort().join() === "athlete_id,display_name,group_id,has_pin");
      h.check("an adult is shown by full name", r.rows?.some((x) => x.athlete_id === ann && x.display_name === "Ann Anderson"), JSON.stringify(r));
      r = await find(desk, org, "Anders M");
      h.check("a client under 18 is shown as first name and last initial", r.rows?.length === 1 && r.rows[0].display_name === "Anders M.", JSON.stringify(r));
      r = await find(desk, org, "minorson");
      h.check("and cannot be found by guessing their surname", r.rows?.length === 0, JSON.stringify(r));
      r = await find(desk, org, "unknown");
      h.check("a client with no date of birth on file is shortened too", r.rows?.length === 0, JSON.stringify(r));
      r = await find(desk, org, "Anders U");
      h.check("and is found only by the shortened name", r.rows?.length === 1 && r.rows[0].display_name === "Anders U.", JSON.stringify(r));
      r = await find(desk, org, "an");
      h.check("a client who keeps their records private from the organization is not listed", !r.rows?.some((x) => x.athlete_id === anders));
      h.check("nor a person who is only in a social group", !r.rows?.some((x) => x.athlete_id === social));
      h.check("nor one in a retired season", !r.rows?.some((x) => x.athlete_id === retired));
      h.check("nor a client of another organization", !r.rows?.some((x) => x.athlete_id === elsewhere));
      r = await find(desk, org, "a");
      h.check("one letter lists nobody", r.rows?.length === 0);
      r = await find(desk, org, "%%");
      h.check("a wildcard is not a wildcard", r.rows?.length === 0);
      r = await find(desk, org2, "an");
      h.check("a front-desk person of one organization cannot search another's", !!r.error);
      r = await find(otherDesk, org, "an");
      h.check("nor can a stranger", !!r.error);
      for (const [who, label] of [[coach, "a coach"], [admin, "an admin"], [owner, "the owner"]]) {
        r = await find(who, org, "ann");
        h.check(label + " of the organization can use the same search", !r.error && r.rows.length >= 1, JSON.stringify(r));
      }
      r = await find(ann, org, "ann");
      h.check("a client cannot", !!r.error);

      // an ordinary coach sees only the clients of groups they coach themselves
      r = await find(coach2, org, "ann");
      h.check("a second coach of the organization finds none of another coach's clients", !r.error && r.rows.length === 0, JSON.stringify(r));
      r = await find(coach, org, "ann");
      h.check("a coach finds their own client", !r.error && r.rows.some((x) => x.athlete_id === ann), JSON.stringify(r));
      v0 = await (async () => {
        await h.as(coach2);
        const x = await tryQ(db, "select public.front_desk_check_in($1, $2, '1234') as r", [gAnn, ann]);
        await h.asSuper();
        return x;
      })();
      h.check("and a second coach cannot check in another coach's client", !!v0.error, JSON.stringify(v0));

      // ---- checking in
      const checkIn = async (who, group, athlete, pin) => {
        await h.as(who);
        const x = await tryQ(db, `select public.front_desk_check_in($1, $2, $3) as r`, [group, athlete, pin]);
        await h.asSuper();
        return x.error ? { error: x.error } : x.rows[0].r;
      };
      const countCheckins = async (g, a) => (await db.query(`select count(*)::int as n from public.kiosk_checkins where group_id = $1 and athlete_id = $2`, [g, a])).rows[0].n;
      let v = await checkIn(desk, gAnn, ann, "0000");
      h.check("a wrong code answers 'wrong' and records nothing", v.result === "wrong" && (await countCheckins(gAnn, ann)) === 0, JSON.stringify(v));
      v = await checkIn(desk, gAnn, ann, "1234");
      h.check("the right code checks the client in", v.result === "ok" && !!v.checked_in_at && (await countCheckins(gAnn, ann)) === 1, JSON.stringify(v));
      const tries = [];
      for (let i = 0; i < 5; i++) tries.push((await checkIn(desk, gAnn, ann, "0000")).result);
      h.check("five wrong codes lock it, the same lock the coach's kiosk uses", tries.join() === "wrong,wrong,wrong,wrong,locked", tries.join());
      v = await checkIn(desk, gAnn, ann, "1234");
      h.check("a locked code stays locked even for the right code", v.result === "locked" && (await countCheckins(gAnn, ann)) === 1, JSON.stringify(v));
      await db.query(`update public.kiosk_pins set locked_until = null, failed_attempts = 0 where group_id = $1 and athlete_id = $2`, [gAnn, ann]);
      v = await checkIn(coach, gAnn, ann, "1234");
      h.check("the client's coach can check in too", v.result === "ok" && (await countCheckins(gAnn, ann)) === 2, JSON.stringify(v));

      v = await checkIn(desk, gPriv, anders, "1234");
      h.check("a client private from the organization cannot be checked in from the front desk", !!v.error && (await countCheckins(gPriv, anders)) === 0, JSON.stringify(v));
      v = await checkIn(desk, gOther, elsewhere, "1234");
      h.check("nor a client of another organization", !!v.error && (await countCheckins(gOther, elsewhere)) === 0, JSON.stringify(v));
      v = await checkIn(otherDesk, gAnn, ann, "1234");
      h.check("a stranger cannot check anyone in", !!v.error, JSON.stringify(v));
      v = await checkIn(ann, gAnn, ann, "1234");
      h.check("nor can a client check themselves in through it", !!v.error, JSON.stringify(v));
      v = await checkIn(desk, gRetired, retired, "1234");
      h.check("nor a retired season", !!v.error, JSON.stringify(v));
      v = await checkIn(desk, gSocial, social, "1234");
      h.check("nor a social-only member", !!v.error, JSON.stringify(v));

      // ---- the coach's own check is still coach-only
      await h.as(desk);
      r = await tryQ(db, `select public.verify_kiosk_pin($1, $2, '1234')`, [gAnn, ann]);
      h.check("the front desk cannot test a code directly (that stays the group coach's)", !!r.error && /not authorized/.test(r.error), JSON.stringify(r));
      await h.as(coach);
      r = await tryQ(db, `select public.verify_kiosk_pin($1, $2, '1234') as r`, [gAnn, ann]);
      h.check("the coach still can", !r.error && r.rows[0].r === "ok", JSON.stringify(r));
      await h.asSuper();

      // ---- a coach whose access has ended can no longer use it
      await db.query(`update public.organization_memberships set access_ended_at = now() where organization_id = $1 and profile_id = $2`, [org, coach]);
      r = await find(coach, org, "ann");
      h.check("a coach whose access to the organization has ended cannot", !!r.error);
      await db.query(`update public.organization_memberships set access_ended_at = null where organization_id = $1 and profile_id = $2`, [org, coach]);

      // ---- removing
      await db.query(`insert into public.org_front_desk (organization_id, profile_id) values ($1, $2)`, [org, desk2]);
      await h.as(desk);
      r = await tryQ(db, `select public.remove_front_desk($1, $2)`, [org, desk2]);
      h.check("a front-desk person cannot remove another", !!r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.remove_front_desk($1, $2)`, [org, desk2]);
      h.check("nor can a plain coach", !!r.error);
      await h.as(admin);
      r = await tryQ(db, `select public.remove_front_desk($1, $2)`, [org, desk2]);
      await h.asSuper();
      h.check("an admin removes one" + (r.error ? ": " + r.error : ""), !r.error && (await db.query(`select count(*)::int as n from public.org_front_desk where profile_id = $1`, [desk2])).rows[0].n === 0);
      await h.as(owner);
      r = await tryQ(db, `select count(*)::int as n from public.org_front_desk where organization_id = $1`, [org]);
      h.check("the owner can see who is on the front desk", r.rows?.[0]?.n === 1, JSON.stringify(r));
      await h.as(coach);
      r = await tryQ(db, `select count(*)::int as n from public.org_front_desk where organization_id = $1`, [org]);
      h.check("a plain coach cannot", r.rows?.[0]?.n === 0, JSON.stringify(r));
      await h.as(desk);
      r = await tryQ(db, `select public.remove_front_desk($1, $2)`, [org, desk]);
      await h.asSuper();
      h.check("a front-desk person can leave", !r.error && (await db.query(`select count(*)::int as n from public.org_front_desk where profile_id = $1`, [desk])).rows[0].n === 0);
      r = await find(desk, org, "ann");
      h.check("and then can no longer search", !!r.error);

      // ---- one person cannot lock many clients out: at most 10 wrong codes in 15 minutes across all clients
      const deskT = await h.user("FD Throttled Desk");
      await db.query(`insert into public.org_front_desk (organization_id, profile_id) values ($1, $2)`, [org, deskT]);
      const three = [];
      for (const n of ["One", "Two", "Three"]) {
        const c = await h.user("Throttle " + n);
        const g = await h.group(org, coach, "one_on_one", "FD Throttle " + n);
        await h.member(g, c);
        await h.as(coach);
        await db.query(`select public.set_kiosk_pin($1, $2, '1234')`, [g, c]);
        await h.asSuper();
        three.push([g, c]);
      }
      const wrongs = [];
      for (const [i, [g, c]] of three.entries()) for (let k = 0; k < (i === 2 ? 2 : 4); k++) wrongs.push((await checkIn(deskT, g, c, "0000")).result);
      h.check("ten wrong codes across three clients are all answered 'wrong' (no client reached its own five-try lock)", wrongs.length === 10 && wrongs.every((x) => x === "wrong"), wrongs.join());
      v = await checkIn(deskT, three[2][0], three[2][1], "1234");
      h.check("the eleventh try is held back even with the right code", v.result === "throttled" && (await countCheckins(three[2][0], three[2][1])) === 0, JSON.stringify(v));
      v = await checkIn(coach, three[2][0], three[2][1], "1234");
      h.check("another person (the client's coach) is not held back", v.result === "ok", JSON.stringify(v));
      await db.query(`update public.front_desk_pin_misses set missed_at = now() - interval '20 minutes' where caller = $1`, [deskT]);
      v = await checkIn(deskT, three[0][0], three[0][1], "1234");
      h.check("and after 15 minutes the person can try again", v.result === "ok", JSON.stringify(v));

      // ---- an owner or admin whose access has ended has no say over the front desk
      await db.query(`insert into public.org_front_desk (organization_id, profile_id) values ($1, $2) on conflict do nothing`, [org, desk]);
      await db.query(`update public.organization_memberships set access_ended_at = now() where organization_id = $1 and profile_id = $2`, [org, admin]);
      await h.as(admin);
      r = await tryQ(db, `select public.remove_front_desk($1, $2)`, [org, desk]);
      h.check("an admin whose access has ended cannot remove a front-desk person", !!r.error);
      r = await tryQ(db, `select count(*)::int as n from public.org_front_desk where organization_id = $1`, [org]);
      h.check("nor see who is on the front desk", r.rows?.[0]?.n === 0, JSON.stringify(r));
      await h.asSuper();
      r = await find(admin, org, "ann");
      h.check("nor use the screen", !!r.error);
      await db.query(`update public.organization_memberships set access_ended_at = null where organization_id = $1 and profile_id = $2`, [org, admin]);

      // ---- closing the organization ends its front desk
      await h.as(owner);
      r = await tryQ(db, `select public.close_organization($1)`, [org]);
      await h.asSuper();
      h.check("closing the organization works" + (r.error ? ": " + r.error : ""), !r.error);
      h.check("and ends its front desk", (await db.query(`select count(*)::int as n from public.org_front_desk where organization_id = $1`, [org])).rows[0].n === 0);
      r = await find(deskT, org, "ann");
      h.check("a front-desk person of a closed organization can no longer search", !!r.error);
    },
  },
};
