// 0393: an existing account is invited to be a coach's one-on-one client and joins only by accepting. Also: the notification types the invite code writes are now accepted by the database.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0393 Space invitations",
  migrations: ["0393"],
  phases: {
    async "0393"({ db, h }) {
      const coach = await h.user("SI Coach");
      const otherCoach = await h.user("SI Other Coach");
      const person = await h.user("SI Person");
      const stranger = await h.user("SI Stranger");
      const org = await h.org(coach, "SI Gym");
      const space = await h.group(org, coach, "one_on_one", "SI space");
      const otherOrg = await h.org(otherCoach, "SI Other Gym");
      const theirs = await h.group(otherOrg, otherCoach, "one_on_one", "SI their space");
      await h.member(theirs, person);

      await h.asSuper();
      // ---- notification types
      for (const type of ["organization_invite", "space_invite", "org_announcement"]) {
        const r = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, $2, 'x', '/x')`, [person, type]);
        h.check(`the database accepts a '${type}' notification` + (r.error ? ": " + r.error : ""), !r.error);
      }
      const old = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, 'program_assigned', 'x', '/x')`, [person]);
      h.check("the older types still work" + (old.error ? ": " + old.error : ""), !old.error);
      const bad = await tryQ(db, `insert into public.notifications (profile_id, type, body, link_path) values ($1, 'nonsense', 'x', '/x')`, [person]);
      h.check("an unknown type is still refused", !!bad.error);

      // ---- the invitation
      const inv = (await db.query(`insert into public.space_invites (group_id, invited_profile_id, created_by) values ($1, $2, $3) returning id`, [space, person, coach])).rows[0].id;
      const dup = await tryQ(db, `insert into public.space_invites (group_id, invited_profile_id, created_by) values ($1, $2, $3)`, [space, person, coach]);
      h.check("only one open invitation per person and space", !!dup.error);

      await h.as(person);
      const seen = await db.query(`select id from public.space_invites`);
      h.check("the invited person sees their invitation", seen.rows.length === 1);
      await h.as(stranger);
      h.check("a stranger sees none", (await db.query(`select id from public.space_invites`)).rows.length === 0);
      let r = await tryQ(db, `select public.answer_space_invite($1, true)`, [inv]);
      h.check("a stranger cannot answer it", /not found/.test(r.error ?? ""), r.error);
      await h.as(coach);
      h.check("the coach of the space sees it", (await db.query(`select id from public.space_invites`)).rows.length === 1);
      r = await tryQ(db, `select public.answer_space_invite($1, true)`, [inv]);
      h.check("the coach cannot answer for the person", /not found/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `insert into public.space_invites (group_id, invited_profile_id, created_by) values ($1, $2, $3)`, [space, stranger, coach]);
      h.check("nobody signed in can write an invitation directly", !!r.error);

      await h.as(person);
      r = await tryQ(db, `select public.answer_space_invite($1, true) as g`, [inv]);
      h.check("the person accepts" + (r.error ? ": " + r.error : ""), !r.error && r.rows[0].g === space);
      await h.asSuper();
      h.check("they are now the client of the coach's space, and still a client of their other coach's", (await db.query(`select group_id from public.group_memberships where profile_id = $1 and role = 'athlete' order by group_id`, [person])).rows.length === 2);
      await h.as(person);
      r = await tryQ(db, `select public.answer_space_invite($1, true)`, [inv]);
      h.check("an answered invitation cannot be answered again", /already been answered/.test(r.error ?? ""), r.error);

      // ---- a space that already has its client, an expired invitation, decline, cancel
      await h.asSuper();
      const full = await h.group(org, coach, "one_on_one", "SI full space");
      await h.member(full, stranger);
      const late = (await db.query(`insert into public.space_invites (group_id, invited_profile_id, created_by) values ($1, $2, $3) returning id`, [full, otherCoach, coach])).rows[0].id;
      await h.as(otherCoach);
      r = await tryQ(db, `select public.answer_space_invite($1, true)`, [late]);
      h.check("a space that already has a client cannot take another", /already has a client/.test(r.error ?? ""), r.error);
      await h.asSuper();
      const stale = (await db.query(`insert into public.space_invites (group_id, invited_profile_id, created_by, expires_at) values ($1, $2, $3, now() - interval '1 day') returning id`, [space, otherCoach, coach])).rows[0].id;
      await h.as(otherCoach);
      r = await tryQ(db, `select public.answer_space_invite($1, true)`, [stale]);
      h.check("an expired invitation cannot be accepted", /expired/.test(r.error ?? ""), r.error);
      r = await tryQ(db, `select public.answer_space_invite($1, false)`, [late]);
      h.check("declining works and joins nothing", !r.error);
      await h.asSuper();
      h.check("declining left no membership", (await db.query(`select 1 from public.group_memberships where group_id = $1 and profile_id = $2`, [full, otherCoach])).rows.length === 0);
      const toCancel = (await db.query(`insert into public.space_invites (group_id, invited_profile_id, created_by) values ($1, $2, $3) returning id`, [full, person, coach])).rows[0].id;
      await h.as(stranger);
      r = await tryQ(db, `select public.cancel_space_invite($1)`, [toCancel]);
      h.check("someone who does not coach the space cannot cancel", !!r.error);
      await h.as(coach);
      r = await tryQ(db, `select public.cancel_space_invite($1)`, [toCancel]);
      h.check("the coach cancels an open invitation", !r.error, r.error);
      await h.as(person);
      r = await tryQ(db, `select public.answer_space_invite($1, true)`, [toCancel]);
      h.check("a cancelled invitation cannot be accepted", /already been answered/.test(r.error ?? ""), r.error);
    },
  },
};
