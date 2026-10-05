// 0255 legal acceptances + locked waiver; 0256 marketplace listing is opt-in; 0257 feedback reports (platform admin reads); 0258 nav query log.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0255 legal acceptances, 0256 listing opt-in, 0257 feedback reports, 0258 nav log",
  migrations: ["0255", "0256", "0257", "0258"],
  phases: {
    // Before 0256: an organization that already exists must come out unlisted.
    async "0254"({ db, h, state }) {
      const c = await h.user("Existing org coach");
      state.existingOrg = await h.org(c);
    },

    async "0255"({ db, h }) {
      const coach = await h.user("Legal Coach");
      const ann = await h.user("Legal Ann");
      const bo = await h.user("Legal Bo");
      const otherCoach = await h.user("Legal Other Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Legal group");
      await h.member(group, ann);
      await h.member(group, bo);
      const og = await h.org(otherCoach);
      await h.group(og, otherCoach, "team", "Elsewhere");

      // service role writes acceptances (the server does, with the real address and device)
      await h.asService();
      for (const [who, doc, ver] of [[ann, "waiver", "v1"], [ann, "terms", "v1"], [bo, "waiver", "v1"]]) {
        await db.query(`insert into public.legal_acceptances (profile_id, document, version, ip, user_agent, text_snapshot) values ($1, $2, $3, '203.0.113.9', 'test', 'I agree...')`, [who, doc, ver]);
      }
      h.check("the server (service role) can record an acceptance", true);
      h.check("accepting the same document and version twice is refused (one row each)", !!(await tryQ(db, `insert into public.legal_acceptances (profile_id, document, version) values ($1, 'waiver', 'v1')`, [ann])).error);
      h.check("a document type outside the list is refused", !!(await tryQ(db, `insert into public.legal_acceptances (profile_id, document, version) values ($1, 'contract', 'v1')`, [ann])).error);
      await h.asSuper();
      await db.query(`insert into public.client_intake (athlete_id, group_id, completed_at) values ($1, $2, now())`, [ann, group]);
      await db.query(`insert into public.client_intake (athlete_id, group_id) values ($1, $2)`, [bo, group]);

      await h.as(ann);
      h.check("a person reads their own acceptances", (await h.rows(`select 1 from public.legal_acceptances`)).length === 2);
      h.check("a browser cannot add an acceptance (no insert policy)", !!(await tryQ(db, `insert into public.legal_acceptances (profile_id, document, version) values ($1, 'privacy', 'v1')`, [ann])).error);
      let r = await tryQ(db, `update public.legal_acceptances set version = 'v2' where profile_id = $1 returning 1`, [ann]);
      h.check("a browser cannot edit an acceptance", (r.error || r.rows.length === 0));
      r = await tryQ(db, `delete from public.legal_acceptances where profile_id = $1 returning 1`, [ann]);
      h.check("a browser cannot delete an acceptance", (r.error || r.rows.length === 0));
      await h.as(coach);
      const seen = await h.rows(`select profile_id, document from public.legal_acceptances`);
      h.check("a coach sees the waiver acceptances of their own clients, and only the waiver", seen.length === 2 && seen.every((x) => x.document === "waiver"), JSON.stringify(seen));
      await h.as(otherCoach);
      h.check("another organization's coach sees none", (await h.rows(`select 1 from public.legal_acceptances`)).length === 0);

      // client_intake: complete it, then it is locked
      await h.as(bo);
      r = await tryQ(db, `update public.client_intake set waiver_signed_name = 'Bo Legal' where athlete_id = $1 returning 1`, [bo]);
      h.check("an athlete can fill in their intake while it is not completed", r.rows?.length === 1);
      r = await tryQ(db, `update public.client_intake set completed_at = now(), waiver_accepted = true where athlete_id = $1 returning 1`, [bo]);
      h.check("...and complete it", r.rows?.length === 1);
      r = await tryQ(db, `update public.client_intake set waiver_signed_name = 'Someone Else' where athlete_id = $1 returning 1`, [bo]);
      h.check("once completed, the signed waiver cannot be rewritten by the athlete", (r.error || r.rows.length === 0));
      await h.as(ann);
      r = await tryQ(db, `update public.client_intake set waiver_signed_name = 'Changed' where athlete_id = $1 returning 1`, [ann]);
      h.check("a completed intake that was created completed is also locked", (r.error || r.rows.length === 0));
      r = await tryQ(db, `delete from public.client_intake where athlete_id = $1 returning 1`, [ann]);
      h.check("an athlete cannot delete their intake", (r.error || r.rows.length === 0));
      const stranger = await h.user("Legal Stranger");
      const victim = await h.user("Legal Victim");
      await h.as(stranger);
      h.check("an athlete can create their own intake row", !!(await tryQ(db, `insert into public.client_intake (athlete_id, group_id) values ($1, $2)`, [stranger, group])).rows);
      h.check("...but not one for somebody else", !!(await tryQ(db, `insert into public.client_intake (athlete_id, group_id) values ($1, $2)`, [victim, group])).error);
      await h.as(coach);
      h.check("the coach still reads their client's intake", (await h.rows(`select 1 from public.client_intake where athlete_id = $1`, [ann])).length === 1);
    },

    async "0256"({ db, h, state }) {
      await h.asSuper();
      h.check("0256: an organization that existed before the migration is not listed publicly", (await h.one(`select listed_in_marketplace as v from public.organizations where id = $1`, [state.existingOrg])).v === false);
      const c = await h.user("New org coach");
      const org = await h.org(c);
      await h.asSuper();
      h.check("0256: a new organization starts unlisted too", (await h.one(`select listed_in_marketplace as v from public.organizations where id = $1`, [org])).v === false);
      await h.as(c);
      const r = await tryQ(db, `update public.organizations set listed_in_marketplace = true where id = $1 returning listed_in_marketplace`, [org]);
      h.check("0256: the owner can switch listing on", r.rows?.[0]?.listed_in_marketplace === true, r.error);
      const other = await h.user("Not the owner");
      await h.as(other);
      const r2 = await tryQ(db, `update public.organizations set listed_in_marketplace = true where id = $1 returning 1`, [state.existingOrg]);
      h.check("0256: someone who is not an owner or admin cannot list another organization", (r2.error || r2.rows.length === 0));
    },

    async "0257"({ db, h }) {
      const admin = await h.platformAdmin("Feedback Admin");
      const user = await h.user("Feedback User");
      await h.asService();
      await db.query(`insert into public.feedback_reports (profile_id, message, page_path, user_agent, viewport) values ($1, 'The button is hidden', '/groups/x', 'UA', '375x812')`, [user]);
      h.check("the server can record a report", true);
      h.check("an empty message is refused", !!(await tryQ(db, `insert into public.feedback_reports (profile_id, message) values ($1, '')`, [user])).error);
      h.check("a message over 4000 characters is refused", !!(await tryQ(db, `insert into public.feedback_reports (profile_id, message) values ($1, $2)`, [user, "x".repeat(4001)])).error);
      h.check("a kind outside problem/idea is refused", !!(await tryQ(db, `insert into public.feedback_reports (profile_id, kind, message) values ($1, 'rant', 'x')`, [user])).error);
      await h.as(user);
      h.check("the person who sent a report cannot read reports (only the platform admin does)", (await h.rows(`select 1 from public.feedback_reports`)).length === 0);
      h.check("a signed-in user cannot insert a report directly (the server adds the real address and device)", !!(await tryQ(db, `insert into public.feedback_reports (profile_id, message) values ($1, 'x')`, [user])).error);
      await h.as(admin);
      h.check("the platform admin reads reports", (await h.rows(`select 1 from public.feedback_reports`)).length === 1);
      const r = await tryQ(db, `update public.feedback_reports set status = 'seen' returning status`);
      h.check("the platform admin can mark one seen", r.rows?.[0]?.status === "seen", r.error);
      await h.as(null);
      h.check("a signed-out visitor reads nothing", (() => 0)() === 0 && await (async () => { const q = await tryQ(db, `select count(*)::int as n from public.feedback_reports`); return q.error ? true : q.rows[0].n === 0; })());
    },

    async "0258"({ db, h }) {
      const admin = await h.platformAdmin("Nav Admin");
      const user = await h.user("Nav User");
      await h.asService();
      await db.query(`insert into public.nav_query_log (role, device, outcome, intent_ids, query_text) values ('coach', 'desktop', 'unsure', '{}', 'where do i see the thing')`);
      h.check("the server can log a question the help layer could not answer", true);
      h.check("a role outside coach/athlete is refused", !!(await tryQ(db, `insert into public.nav_query_log (role, device, outcome) values ('admin', 'desktop', 'navigate')`)).error);
      h.check("an outcome outside the list is refused", !!(await tryQ(db, `insert into public.nav_query_log (role, device, outcome) values ('coach', 'desktop', 'weird')`)).error);
      await h.as(user);
      h.check("an ordinary user cannot read the log", (await h.rows(`select 1 from public.nav_query_log`)).length === 0);
      h.check("an ordinary user cannot write to it", !!(await tryQ(db, `insert into public.nav_query_log (role, device, outcome) values ('coach', 'desktop', 'navigate')`)).error);
      await h.as(admin);
      h.check("the platform admin reads it", (await h.rows(`select 1 from public.nav_query_log`)).length === 1);
      h.check("the log has no column that identifies a person", !(await h.rows(`select column_name from information_schema.columns where table_name = 'nav_query_log' and column_name in ('profile_id', 'user_id', 'coach_id', 'athlete_id', 'email')`)).length);
    },
  },
};
