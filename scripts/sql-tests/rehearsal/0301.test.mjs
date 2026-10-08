// 0301: the AI budget helpers. One pool per organization: its size, and this month's AI use summed by model across every coach in it, counting only calls that finished. Server-only.
// Paid top-up packs and the once-a-month notices live in tables the app cannot touch. The per-client food-tracking switch (0300) is the coach's to set.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0301 AI budget",
  migrations: ["0301"],
  phases: {
    async "0300"({ db, h }) {
      const owner = await h.user("AB Owner");
      const coach2 = await h.user("AB Second Coach");
      const soloCoach = await h.user("AB Solo Coach");
      const ann = await h.user("AB Ann");
      const bob = await h.user("AB Bob");
      const cat = await h.user("AB Cat");
      const org = await h.org(owner);
      const group = await h.group(org, owner, "team", "AB group");
      await h.member(group, ann);
      await h.member(group, bob);
      // a second coach in the same gym, with their own group and client
      const group2 = await h.group(org, coach2, "team", "AB group two");
      await h.member(group2, cat);
      const soloOrg = await h.org(soloCoach);
      await h.group(soloOrg, soloCoach, "team", "AB solo group");
      await h.asSuper();
      await db.query(`insert into public.organization_memberships (organization_id, profile_id, role) values ($1, $2, 'coach') on conflict do nothing`, [org, coach2]);
      const log = (c, feature, model, inTok, outTok, status, when = "now()") =>
        db.query(`insert into public.ai_usage_log (user_id, coach_id, feature, model, input_tokens, output_tokens, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, ${when})`, [ann, c, feature, model, inTok, outTok, status]);
      await log(owner, "food_photo_parse", "claude-sonnet-5", 1500, 200, "ok");
      await log(owner, "food_photo_parse", "claude-sonnet-5", 1500, 200, "ok");
      await log(coach2, "program_generation", "claude-sonnet-5", 4000, 9000, "truncated");
      await log(owner, "coach_briefing", "claude-haiku-5-5", 3000, 400, "ok");
      await log(owner, "food_log_parse", "claude-sonnet-5", 900, 100, "error"); // failed: never counted
      await log(owner, "food_log_parse", null, null, null, "started"); // still running / died: no tokens, not counted
      await log(owner, "session_nl", "claude-sonnet-5", 800, 150, "ok", "now() - interval '70 days'"); // an earlier month
      await log(soloCoach, "program_chat", "claude-sonnet-5", 5000, 5000, "ok");
      globalThis.__ab = { owner, coach2, soloCoach, ann, bob, cat, org, soloOrg, group };
    },

    async "0301"({ db, h }) {
      const { owner, coach2, soloCoach, ann, org, soloOrg, group } = globalThis.__ab;

      // ---- the organization's size ----
      await h.asService();
      const sum = await tryQ(db, `select clients, coaches, billing_exempt, ai_scale, owner_unlimited from public.ai_org_summary($1)`, [org]);
      h.check("a gym's budget size counts its clients across all its groups and its coaches", sum.rows?.[0]?.clients === 3 && sum.rows?.[0]?.coaches === 2, JSON.stringify(sum));
      const solo = await tryQ(db, `select clients, coaches from public.ai_org_summary($1)`, [soloOrg]);
      h.check("a solo coach's organization is one coach and no clients", solo.rows?.[0]?.coaches === 1 && solo.rows?.[0]?.clients === 0, JSON.stringify(solo));
      h.check("by default it is billed normally, with no scale set and no internal unlimited owner", sum.rows?.[0]?.billing_exempt === false && sum.rows?.[0]?.ai_scale === null && sum.rows?.[0]?.owner_unlimited === false, JSON.stringify(sum.rows?.[0]));
      await h.asSuper();
      await db.query(`insert into public.organization_billing (organization_id, billing_exempt, ai_allowance_scale) values ($1, true, 1) on conflict (organization_id) do update set billing_exempt = true, ai_allowance_scale = 1`, [org]);
      await db.query(`insert into public.coach_credits (coach_id, ai_access_mode) values ($1, 'unlimited') on conflict (coach_id) do update set ai_access_mode = 'unlimited'`, [owner]);
      await h.asService();
      const flags = await tryQ(db, `select billing_exempt, ai_scale::int as s, owner_unlimited from public.ai_org_summary($1)`, [org]);
      h.check("it reports a free-access organization, its own scale, and an internal unlimited owner", flags.rows?.[0]?.billing_exempt === true && flags.rows?.[0]?.s === 1 && flags.rows?.[0]?.owner_unlimited === true, JSON.stringify(flags));

      // ---- the pool: every coach in the organization, by model, finished calls only ----
      const usage = await tryQ(db, `select model, input_tokens::int as i, output_tokens::int as o, calls::int as c from public.ai_org_month_usage($1, null) order by model`, [org]);
      h.check("the server reads the whole organization's month of AI use, summed by model", !usage.error && usage.rows?.length === 2, JSON.stringify(usage));
      const sonnet = usage.rows?.find((r) => r.model === "claude-sonnet-5");
      const haiku = usage.rows?.find((r) => r.model === "claude-haiku-5-5");
      h.check("both coaches' finished and cut-off calls count (2 photos by the owner + 1 cut-off generation by the second coach)", sonnet?.i === 7000 && sonnet?.o === 9400 && sonnet?.c === 3, JSON.stringify(sonnet));
      h.check("another model is summed on its own", haiku?.i === 3000 && haiku?.o === 400 && haiku?.c === 1, JSON.stringify(haiku));
      h.check("failed calls, calls that never finished and last month's calls are not counted", (usage.rows ?? []).reduce((s, r) => s + r.c, 0) === 4, JSON.stringify(usage.rows));
      const other = await tryQ(db, `select calls::int as c from public.ai_org_month_usage($1, null)`, [soloOrg]);
      h.check("another organization's use is never mixed in", other.rows?.length === 1 && other.rows[0].c === 1, JSON.stringify(other));
      const since = await tryQ(db, `select sum(calls)::int as c from public.ai_org_month_usage($1, now() - interval '100 days')`, [org]);
      h.check("an earlier start date reaches back (the earlier month's call is then included)", since.rows?.[0]?.c === 5, JSON.stringify(since));

      // ---- server-only ----
      await h.as(owner);
      const asCoach = await tryQ(db, `select * from public.ai_org_month_usage($1, null)`, [org]);
      h.check("a signed-in owner cannot run the budget functions themselves", !!asCoach.error, JSON.stringify(asCoach));
      await h.asSuper();
      const priv = await h.one(`select
        has_function_privilege('anon', 'public.ai_org_month_usage(uuid, timestamptz)', 'execute') as a1, has_function_privilege('authenticated', 'public.ai_org_month_usage(uuid, timestamptz)', 'execute') as s1, has_function_privilege('service_role', 'public.ai_org_month_usage(uuid, timestamptz)', 'execute') as v1,
        has_function_privilege('anon', 'public.ai_org_summary(uuid)', 'execute') as a2, has_function_privilege('authenticated', 'public.ai_org_summary(uuid)', 'execute') as s2, has_function_privilege('service_role', 'public.ai_org_summary(uuid)', 'execute') as v2`);
      h.check("only the server can run either function: no privilege for a signed-out visitor or a signed-in person", !priv.a1 && !priv.s1 && priv.v1 && !priv.a2 && !priv.s2 && priv.v2, JSON.stringify(priv));

      // ---- top-ups and notices: tables the app cannot touch ----
      await h.as(owner);
      const notices = await tryQ(db, `select * from public.ai_budget_notices`);
      const topups = await tryQ(db, `select * from public.ai_budget_topups`);
      h.check("an owner cannot read the notice or top-up records", (!!notices.error || (notices.rows?.length ?? 0) === 0) && (!!topups.error || (topups.rows?.length ?? 0) === 0), JSON.stringify({ notices, topups }));
      const forgeTop = await tryQ(db, `insert into public.ai_budget_topups (organization_id, month, usd_added, pack_cents, stripe_event_id) values ($1, '2026-10-01', 500, 500, 'evt_forged')`, [org]);
      const forgeNote = await tryQ(db, `insert into public.ai_budget_notices (organization_id, month, level) values ($1, '2026-10-01', 'out')`, [org]);
      h.check("or write either (a person cannot top up their own budget)", !!forgeTop.error && !!forgeNote.error, JSON.stringify({ forgeTop, forgeNote }));

      await h.asService();
      const t1 = await tryQ(db, `insert into public.ai_budget_topups (organization_id, month, usd_added, pack_cents, stripe_event_id) values ($1, '2026-10-01', 3.5, 500, 'evt_1') returning id`, [org]);
      const t1again = await tryQ(db, `insert into public.ai_budget_topups (organization_id, month, usd_added, pack_cents, stripe_event_id) values ($1, '2026-10-01', 3.5, 500, 'evt_1')`, [org]);
      h.check("the payment webhook records a top-up once per payment (a repeat of the same event is refused)", t1.rows?.length === 1 && !!t1again.error, JSON.stringify({ t1, t1again }));
      const zero = await tryQ(db, `insert into public.ai_budget_topups (organization_id, month, usd_added, pack_cents, stripe_event_id) values ($1, '2026-10-01', 0, 500, 'evt_2')`, [org]);
      h.check("a top-up must add something", !!zero.error, JSON.stringify(zero));

      const first = await tryQ(db, `insert into public.ai_budget_notices (organization_id, month, level) values ($1, '2026-10-01', 'low') on conflict do nothing returning level`, [org]);
      const again = await tryQ(db, `insert into public.ai_budget_notices (organization_id, month, level) values ($1, '2026-10-01', 'low') on conflict do nothing returning level`, [org]);
      h.check("the first notice for a month is recorded and a repeat is a no-op (so the organization is told once)", first.rows?.length === 1 && again.rows?.length === 0, JSON.stringify({ first, again }));
      const next = await tryQ(db, `insert into public.ai_budget_notices (organization_id, month, level) values ($1, '2026-10-01', 'out') on conflict do nothing returning level`, [org]);
      h.check("'used up' is a separate notice from 'running low'", next.rows?.length === 1, JSON.stringify(next));
      const badLevel = await tryQ(db, `insert into public.ai_budget_notices (organization_id, month, level) values ($1, '2026-11-01', 'whatever')`, [org]);
      h.check("an unknown level is refused", !!badLevel.error, JSON.stringify(badLevel));

      // ---- the food-tracking switch (0300) ----
      await h.asSuper();
      const dflt = await h.one(`select food_tracking_enabled from public.group_memberships where group_id = $1 and profile_id = $2`, [group, ann]);
      h.check("food tracking is on by default for every client", dflt.food_tracking_enabled === true, JSON.stringify(dflt));
      await h.as(owner);
      const off = await tryQ(db, `update public.group_memberships set food_tracking_enabled = false where group_id = $1 and profile_id = $2 returning food_tracking_enabled`, [group, ann]);
      h.check("the client's coach can turn it off", !off.error && off.rows?.[0]?.food_tracking_enabled === false, JSON.stringify(off));
      await h.as(soloCoach);
      const stranger = await tryQ(db, `update public.group_memberships set food_tracking_enabled = true where group_id = $1 and profile_id = $2 returning food_tracking_enabled`, [group, ann]);
      h.check("another organization's coach cannot touch it", !stranger.error && (stranger.rows?.length ?? 0) === 0, JSON.stringify(stranger));
      await h.as(ann);
      const self = await tryQ(db, `update public.group_memberships set food_tracking_enabled = true where group_id = $1 and profile_id = $2 returning food_tracking_enabled`, [group, ann]);
      h.check("and the client cannot turn their own switch back on", !self.error && (self.rows?.length ?? 0) === 0, JSON.stringify(self));
      void coach2;

      // ---- the prepared data step that turns the internal unlimited tester coaches into metered ones (supabase/data/ai-testers-to-metered.sql, run only on Ron's word) ----
      await h.asSuper();
      const tA = await h.user("AB Tester A");
      const tB = await h.user("AB Tester B");
      const metered = await h.user("AB Metered Owner");
      const orgA = await h.org(tA);
      const orgB = await h.org(tB);
      const orgM = await h.org(metered);
      const keeper = await h.user("AB Keeper");
      const orgK = await h.org(keeper);
      await db.query(`update auth.users set email = 'ronarnold4210@gmail.com' where id = $1`, [keeper]);
      await db.query(`insert into public.organization_billing (organization_id, billing_exempt) values ($1, true) on conflict (organization_id) do update set billing_exempt = true, ai_allowance_scale = null`, [orgA]);
      await db.query(`delete from public.organization_billing where organization_id = $1`, [orgB]);
      await db.query(`insert into public.coach_credits (coach_id, ai_access_mode) values ($1, 'unlimited'), ($2, 'unlimited'), ($3, 'metered'), ($4, 'unlimited') on conflict (coach_id) do update set ai_access_mode = excluded.ai_access_mode`, [tA, tB, metered, keeper]);
      const text = (await import("node:fs")).readFileSync(new URL("../../../supabase/data/ai-testers-to-metered.sql", import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
      const undoAt = text.indexOf("-- ===== UNDO");
      const undo = text.slice(undoAt).split(String.fromCharCode(10)).filter((l) => l.startsWith("-- ") && !l.startsWith("-- =====")).map((l) => l.slice(3)).join(String.fromCharCode(10));
      // the apply and undo both touch the earlier-made 'unlimited' owner too (every unlimited coach is converted), so compare only the three made here
      await db.exec(text.slice(0, undoAt));
      const after = await h.rows(`select coach_id, ai_access_mode from public.coach_credits where coach_id = any($1::uuid[])`, [[tA, tB, metered, keeper]]);
      const modeOf = (id) => after.find((r) => r.coach_id === id)?.ai_access_mode;
      h.check("the data step makes every unlimited tester coach metered and leaves an already-metered coach alone", modeOf(tA) === "metered" && modeOf(tB) === "metered" && modeOf(metered) === "metered", JSON.stringify(after));
      h.check("Ron's own owner account (on the kept-unlimited list) stays unlimited", modeOf(keeper) === "unlimited", JSON.stringify(after));
      const guarded = await h.one(`select c.relrowsecurity as rls, has_table_privilege('authenticated', '_ai_tester_conversion', 'select') as auth_read, has_table_privilege('anon', '_ai_tester_conversion', 'select') as anon_read from pg_class c where c.relname = '_ai_tester_conversion' and c.relnamespace = 'public'::regnamespace`);
      h.check("the conversion record is locked down: row security on, closed to signed-in and signed-out users", guarded.rls === true && guarded.auth_read === false && guarded.anon_read === false, JSON.stringify(guarded));
      const scales = await h.rows(`select organization_id, ai_allowance_scale::int as s from public.organization_billing where organization_id = any($1::uuid[])`, [[orgA, orgB, orgM, orgK]]);
      const scaleOf = (id) => scales.find((r) => r.organization_id === id)?.s;
      h.check("...and gives their organizations the full standard budget (scale 1), with or without an existing billing row, but not an organization nobody converted", scaleOf(orgA) === 1 && scaleOf(orgB) === 1 && scaleOf(orgM) === undefined && scaleOf(orgK) === undefined, JSON.stringify(scales));
      const kept = await h.one(`select billing_exempt from public.organization_billing where organization_id = $1`, [orgA]);
      h.check("...without touching the free-access flag", kept.billing_exempt === true, JSON.stringify(kept));
      await db.exec(text.slice(0, undoAt));
      h.check("running it again changes nothing more (already-metered coaches are skipped)", (await h.rows(`select 1 from public._ai_tester_conversion where kind = 'coach' and coach_id = $1`, [tA])).length === 1, "second run recorded the tester again");
      await db.exec(undo);
      const back = await h.rows(`select coach_id, ai_access_mode from public.coach_credits where coach_id = any($1::uuid[])`, [[tA, tB, metered, keeper]]);
      const backOf = (id) => back.find((r) => r.coach_id === id)?.ai_access_mode;
      h.check("the undo puts the testers back to unlimited and leaves the metered coach metered", backOf(tA) === "unlimited" && backOf(tB) === "unlimited" && backOf(metered) === "metered" && backOf(keeper) === "unlimited", JSON.stringify(back));
      const scalesBack = await h.rows(`select organization_id, ai_allowance_scale from public.organization_billing where organization_id = any($1::uuid[])`, [[orgA, orgB]]);
      h.check("...and restores the organizations' scales (empty again; a billing row made only for this is removed)", scalesBack.every((r) => r.ai_allowance_scale === null) && !scalesBack.some((r) => r.organization_id === orgB), JSON.stringify(scalesBack));
    },
  },
};
