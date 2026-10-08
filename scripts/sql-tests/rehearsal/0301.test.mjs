// 0301: the AI budget helpers. A coach's month of AI use is summed by model from the usage log, counting only calls that finished; the function is server-only; the once-a-month
// notice record cannot be read or written from the app; and the per-client food-tracking switch (0300) is the coach's to set.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

export default {
  name: "0301 AI budget",
  migrations: ["0301"],
  phases: {
    async "0300"({ db, h }) {
      const coach = await h.user("AB Coach");
      const otherCoach = await h.user("AB Other Coach");
      const ann = await h.user("AB Ann");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "AB group");
      await h.member(group, ann);
      await h.asSuper();
      const log = (c, feature, model, inTok, outTok, status, when = "now()") =>
        db.query(`insert into public.ai_usage_log (user_id, coach_id, feature, model, input_tokens, output_tokens, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, ${when})`, [ann, c, feature, model, inTok, outTok, status]);
      await log(coach, "food_photo_parse", "claude-sonnet-5", 1500, 200, "ok");
      await log(coach, "food_photo_parse", "claude-sonnet-5", 1500, 200, "ok");
      await log(coach, "program_generation", "claude-sonnet-5", 4000, 9000, "truncated");
      await log(coach, "coach_briefing", "claude-haiku-5-5", 3000, 400, "ok");
      await log(coach, "food_log_parse", "claude-sonnet-5", 900, 100, "error"); // failed: never counted
      await log(coach, "food_log_parse", null, null, null, "started"); // still running / died: no tokens, not counted
      await log(coach, "session_nl", "claude-sonnet-5", 800, 150, "ok", "now() - interval '70 days'"); // an earlier month
      await log(otherCoach, "program_chat", "claude-sonnet-5", 5000, 5000, "ok");
      globalThis.__ab = { coach, otherCoach, ann, group };
    },

    async "0301"({ db, h }) {
      const { coach, otherCoach, ann, group } = globalThis.__ab;

      // ---- the month's use, by model, for finished calls only ----
      await h.asService();
      const usage = await tryQ(db, `select model, input_tokens::int as i, output_tokens::int as o, calls::int as c from public.ai_month_usage($1, null) order by model`, [coach]);
      h.check("the server reads a coach's month of AI use, summed by model", !usage.error && usage.rows?.length === 2, JSON.stringify(usage));
      const sonnet = usage.rows?.find((r) => r.model === "claude-sonnet-5");
      const haiku = usage.rows?.find((r) => r.model === "claude-haiku-5-5");
      h.check("finished and cut-off calls count with their real tokens (2 photos + 1 cut-off generation)", sonnet?.i === 7000 && sonnet?.o === 9400 && sonnet?.c === 3, JSON.stringify(sonnet));
      h.check("another model is summed on its own", haiku?.i === 3000 && haiku?.o === 400 && haiku?.c === 1, JSON.stringify(haiku));
      h.check("failed calls, calls that never finished and last month's calls are not counted", (usage.rows ?? []).reduce((s, r) => s + r.c, 0) === 4, JSON.stringify(usage.rows));
      const other = await tryQ(db, `select calls::int as c from public.ai_month_usage($1, null)`, [otherCoach]);
      h.check("one coach's use is never mixed with another's", other.rows?.length === 1 && other.rows[0].c === 1, JSON.stringify(other));
      const since = await tryQ(db, `select sum(calls)::int as c from public.ai_month_usage($1, now() - interval '100 days')`, [coach]);
      h.check("an earlier start date reaches back (the earlier month's call is then included)", since.rows?.[0]?.c === 5, JSON.stringify(since));

      // ---- nobody else can run it or read the notice record ----
      await h.as(coach);
      const asCoach = await tryQ(db, `select * from public.ai_month_usage($1, null)`, [coach]);
      h.check("a signed-in coach cannot run the budget function themselves", !!asCoach.error, JSON.stringify(asCoach));
      const priv = await h.one(`select has_function_privilege('anon', 'public.ai_month_usage(uuid, timestamptz)', 'execute') as anon_can, has_function_privilege('authenticated', 'public.ai_month_usage(uuid, timestamptz)', 'execute') as signed_in_can, has_function_privilege('service_role', 'public.ai_month_usage(uuid, timestamptz)', 'execute') as server_can`);
      h.check("only the server can run it: no privilege for a signed-out visitor or a signed-in person", priv.anon_can === false && priv.signed_in_can === false && priv.server_can === true, JSON.stringify(priv));
      const notices = await tryQ(db, `select * from public.ai_budget_notices`);
      h.check("a coach cannot read the notice record", !!notices.error || (notices.rows?.length ?? 0) === 0, JSON.stringify(notices));
      const forge = await tryQ(db, `insert into public.ai_budget_notices (coach_id, month, level) values ($1, '2026-10-01', 'out')`, [coach]);
      h.check("or write one", !!forge.error, JSON.stringify(forge));

      // ---- told once per month and level ----
      await h.asService();
      const first = await tryQ(db, `insert into public.ai_budget_notices (coach_id, month, level) values ($1, '2026-10-01', 'low') on conflict do nothing returning level`, [coach]);
      const again = await tryQ(db, `insert into public.ai_budget_notices (coach_id, month, level) values ($1, '2026-10-01', 'low') on conflict do nothing returning level`, [coach]);
      h.check("the first notice for a month is recorded and a repeat is a no-op (so the coach is told once)", first.rows?.length === 1 && again.rows?.length === 0, JSON.stringify({ first, again }));
      const next = await tryQ(db, `insert into public.ai_budget_notices (coach_id, month, level) values ($1, '2026-10-01', 'out') on conflict do nothing returning level`, [coach]);
      h.check("'used up' is a separate notice from 'running low'", next.rows?.length === 1, JSON.stringify(next));
      const badLevel = await tryQ(db, `insert into public.ai_budget_notices (coach_id, month, level) values ($1, '2026-11-01', 'whatever')`, [coach]);
      h.check("an unknown level is refused", !!badLevel.error, JSON.stringify(badLevel));

      // ---- the food-tracking switch (0300) ----
      await h.asSuper();
      const dflt = await h.one(`select food_tracking_enabled from public.group_memberships where group_id = $1 and profile_id = $2`, [group, ann]);
      h.check("food tracking is on by default for every client", dflt.food_tracking_enabled === true, JSON.stringify(dflt));
      await h.as(coach);
      const off = await tryQ(db, `update public.group_memberships set food_tracking_enabled = false where group_id = $1 and profile_id = $2 returning food_tracking_enabled`, [group, ann]);
      h.check("the client's coach can turn it off", !off.error && off.rows?.[0]?.food_tracking_enabled === false, JSON.stringify(off));
      await h.as(otherCoach);
      const stranger = await tryQ(db, `update public.group_memberships set food_tracking_enabled = true where group_id = $1 and profile_id = $2 returning food_tracking_enabled`, [group, ann]);
      h.check("another group's coach cannot touch it", !stranger.error && (stranger.rows?.length ?? 0) === 0, JSON.stringify(stranger));
    },
  },
};
