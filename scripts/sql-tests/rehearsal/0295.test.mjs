// 0295: "About you" inputs (activity level, units) a coach can write only through coach_set_body_profile, a starting (baseline) target for a new client, the phase of
// record (client_phase_plans, coach-only, backfilled), and a coach-proposed goal that can carry a phase which becomes the phase of record only when the CLIENT confirms it.
const tryQ = async (db, sql, params) => {
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: String(e.message).split("\n")[0] }; }
};

const WEEKLY_COLS = `athlete_id, group_id, phase, prev_weight_lbs, curr_weight_lbs, current_calories, adherence_days, recovery_rating, consecutive_surplus_spikes, new_calories, rationale, protein_g, carbs_g, fat_g, diet_archetype, dietary_restrictions, status, adjustment_pct`;
const weeklyVals = (n) => `($${n}, $${n + 1}, 'fat_loss', 180, 178, 2200, 6, 4, 0, 2100, 'r', 180, 200, 60, 'standard', '', 'pending', 5)`;

export default {
  name: "0295 about you, baseline, phase of record, goal phase",
  migrations: ["0295"],
  phases: {
    async "0294"({ db, h }) {
      const coach = await h.user("P2 Base Coach");
      const a = await h.user("P2 Base A");
      const b = await h.user("P2 Base B");
      const c = await h.user("P2 Base C");
      const d = await h.user("P2 Base D");
      const e = await h.user("P2 Base E");
      const org = await h.org(coach);
      const g = await h.group(org, coach, "team", "P2 base group");
      for (const x of [a, b, c, d, e]) await h.member(g, x);
      await h.asSuper();
      const insCheckin = (athlete, phase, daysAgo) =>
        db.query(
          `insert into public.nutrition_checkins (athlete_id, group_id, phase, prev_weight_lbs, curr_weight_lbs, current_calories, adherence_days, recovery_rating, new_calories, rationale, protein_g, carbs_g, fat_g, created_by, created_at)
           values ($1, $2, $3, 180, 178, 2200, 6, 4, 2100, 'r', 180, 200, 60, $4, now() - ($5 || ' days')::interval)`,
          [athlete, g, phase, coach, String(daysAgo)]
        );
      // A: hypertrophy 30 days ago, then fat loss 20 and 10 days ago (the current unbroken run began 20 days ago)
      await insCheckin(a, "hypertrophy", 30);
      await insCheckin(a, "fat_loss", 20);
      await insCheckin(a, "fat_loss", 10);
      // D: maintenance only
      await insCheckin(d, "maintenance", 14);
      // B: only a milestone tag (cut), E: a tag (bulk) AND a check-in (maintenance): the check-in wins
      await db.query(`insert into public.nutrition_phases (athlete_id, group_id, phase, started_at, created_by) values ($1, $2, 'cut', '2026-09-01', $3), ($4, $2, 'bulk', '2026-09-02', $3)`, [b, g, coach, e]);
      await insCheckin(e, "maintenance", 5);
      const cols = await h.rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'athlete_profile_details' and column_name in ('activity_level', 'weight_unit', 'portion_units')`);
      h.check("baseline: no activity level or unit columns yet", cols.length === 0, JSON.stringify(cols));
      h.check("baseline: no phase-of-record table yet", (await h.one(`select to_regclass('public.client_phase_plans') is null as none`)).none);
      const nn = await h.one(`select is_nullable from information_schema.columns where table_name = 'nutrition_checkins' and column_name = 'prev_weight_lbs'`);
      h.check("baseline: a check-in cannot be saved without a previous weight", nn.is_nullable === "NO", JSON.stringify(nn));
      const acl = await h.one(`select has_function_privilege('anon', 'public.guard_client_goal_update()', 'execute') as anon, has_function_privilege('authenticated', 'public.guard_client_goal_update()', 'execute') as auth`);
      globalThis.__p2acl = acl;
      // a live type with a digit and a capital (another release might add one): it must survive the rebuild
      const def = (await h.one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'`)).def;
      const list = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).concat(["Legacy_Type3"]);
      await db.query(`alter table public.notifications drop constraint notifications_type_check`);
      await db.query(`alter table public.notifications add constraint notifications_type_check check (type = any (array[${list.map((t) => `'${t}'::text`).join(", ")}]))`);
      globalThis.__p2 = { coach, a, b, c, d, e, g, org };
    },

    async "0295"({ db, h }) {
      const { coach, a, b, c, d, e, g, org } = globalThis.__p2;
      const coach2 = await h.user("P2 Coach Two");
      const stranger = await h.user("P2 Stranger Coach");
      const org2 = await h.org(coach2);
      const g2 = await h.group(org2, coach2, "team", "P2 other group");
      const org3 = await h.org(stranger);
      await h.group(org3, stranger, "team", "P2 stranger group");
      await h.member(g, coach2, "coach"); // a second coach in the same group
      const f = await h.user("P2 Fresh Client");
      await h.member(g, f);
      await h.asSuper();

      // ---- columns and the notification types ----
      const cols = await h.rows(`select column_name, column_default from information_schema.columns where table_schema = 'public' and table_name = 'athlete_profile_details' and column_name in ('activity_level', 'weight_unit', 'portion_units')`);
      h.check("the three new columns exist", cols.length === 3, JSON.stringify(cols));
      const def = (await h.one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_type_check'`)).def;
      h.check("the new notification type is allowed and the type with a digit and a capital that was already there is kept", def.includes("'nutrition_baseline_ready'") && def.includes("'Legacy_Type3'"), def);
      const bad = await tryQ(db, `insert into public.notifications (profile_id, group_id, type, body, link_path) values ($1, $2, 'not_a_type', 'x', '/x')`, [a, g]);
      h.check("an unknown type is still refused", /violates check constraint/.test(bad.error ?? ""), JSON.stringify(bad));

      // ---- the phase of record: backfill ----
      const plans = await h.rows(`select athlete_id, phase, started_on::text as started_on from public.client_phase_plans where group_id = $1`, [g]);
      const planOf = (x) => plans.find((p) => p.athlete_id === x);
      const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
      h.check("backfill: the latest check-in's phase", planOf(a)?.phase === "fat_loss", JSON.stringify(plans));
      h.check("backfill: it started where the current unbroken run began (20 days ago, not 30)", Math.abs((new Date(planOf(a)?.started_on) - new Date(daysAgo(20))) / 86400000) <= 1, JSON.stringify(planOf(a)));
      h.check("backfill: a client with only a milestone tag gets it mapped (cut is fat_loss) from the tag's date", planOf(b)?.phase === "fat_loss" && planOf(b)?.started_on === "2026-09-01", JSON.stringify(planOf(b)));
      h.check("backfill: nothing for a client with no check-in and no tag", !planOf(c));
      h.check("backfill: maintenance is kept as maintenance", planOf(d)?.phase === "maintenance", JSON.stringify(planOf(d)));
      h.check("backfill: a check-in beats a milestone tag", planOf(e)?.phase === "maintenance", JSON.stringify(planOf(e)));

      // ---- the phase of record: who can see and change it ----
      await h.as(coach);
      const mine = await tryQ(db, `select count(*)::int as n from public.client_phase_plans`);
      h.check("a coach of the group reads the plans", mine.rows?.[0]?.n >= 4, JSON.stringify(mine));
      const set = await tryQ(db, `insert into public.client_phase_plans (athlete_id, group_id, phase, started_on, review_on, planned_next_phase, updated_by) values ($1, $2, 'hypertrophy', current_date, current_date + 28, 'maintenance', $3) returning phase`, [c, g, coach]);
      h.check("a coach sets a client's phase, review date and planned next phase", !set.error && set.rows?.[0]?.phase === "hypertrophy", JSON.stringify(set));
      const notClient = await tryQ(db, `insert into public.client_phase_plans (athlete_id, group_id, phase) values ($1, $2, 'maintenance')`, [coach2, g]);
      h.check("a coach cannot make a plan for someone who is not a client in the group", !!notClient.error, JSON.stringify(notClient));
      const badPhase = await tryQ(db, `update public.client_phase_plans set phase = 'bulk' where athlete_id = $1`, [c]);
      h.check("only the four engine phases are accepted", /client_phase_plans_phase_ok/.test(badPhase.error ?? ""), JSON.stringify(badPhase));
      await h.as(c);
      h.check("the client sees none of it (a planned next phase is the coach's private plan)", (await tryQ(db, `select 1 from public.client_phase_plans`)).rows?.length === 0);
      const clientWrite = await tryQ(db, `update public.client_phase_plans set phase = 'maintenance' where athlete_id = $1 returning 1`, [c]);
      const clientIns = await tryQ(db, `insert into public.client_phase_plans (athlete_id, group_id, phase) values ($1, $2, 'maintenance')`, [f, g]);
      h.check("the client cannot change it or make one", (clientWrite.rows ?? []).length === 0 && !!clientIns.error, JSON.stringify({ clientWrite, clientIns }));
      await h.as(stranger);
      h.check("another organization's coach sees none of it", (await tryQ(db, `select 1 from public.client_phase_plans`)).rows?.length === 0);
      await h.as(coach2);
      const sameGroup = await tryQ(db, `select count(*)::int as n from public.client_phase_plans`);
      h.check("a second coach of the same group reads the plans too", sameGroup.rows?.[0]?.n >= 4, JSON.stringify(sameGroup));

      // ---- About you: the client writes their own, a coach only through the function ----
      await h.asSuper();
      await db.query(`insert into public.athlete_profile_details (athlete_id, phone, bio) values ($1, '555-0100', 'private bio') on conflict (athlete_id) do update set phone = '555-0100', bio = 'private bio'`, [f]);
      await h.as(f);
      const own = await tryQ(db, `insert into public.athlete_profile_details (athlete_id, activity_level, weight_unit, portion_units) values ($1, 'moderate', 'kg', 'household') on conflict (athlete_id) do update set activity_level = 'moderate', weight_unit = 'kg', portion_units = 'household' returning activity_level, weight_unit, portion_units`, [f]);
      h.check("a client sets their own activity level and units", !own.error && own.rows?.[0]?.weight_unit === "kg", JSON.stringify(own));
      h.check("a bad activity level is refused", /activity_level_ok/.test((await tryQ(db, `update public.athlete_profile_details set activity_level = 'extreme' where athlete_id = $1`, [f])).error ?? ""));
      h.check("a bad weight unit is refused", /weight_unit_ok/.test((await tryQ(db, `update public.athlete_profile_details set weight_unit = 'stone' where athlete_id = $1`, [f])).error ?? ""));
      h.check("a bad portion unit is refused", /portion_units_ok/.test((await tryQ(db, `update public.athlete_profile_details set portion_units = 'cups' where athlete_id = $1`, [f])).error ?? ""));
      await h.as(coach);
      const direct = await tryQ(db, `update public.athlete_profile_details set height_cm = 180 where athlete_id = $1 returning 1`, [f]);
      h.check("a coach cannot write the table directly (only through the function)", (direct.rows ?? []).length === 0, JSON.stringify(direct));
      const call = (who, args) => tryQ(db, `select * from public.coach_set_body_profile($1, $2, $3, $4, $5, $6, $7, $8, $9)`, args);
      const ok = await call(coach, [f, g, 178, "male", 18.5, "light", null, null, false]);
      h.check("a coach of the group sets height, sex, body fat and activity for their client", !ok.error && Number(ok.rows?.[0]?.height_cm) === 178 && ok.rows?.[0]?.biological_sex === "male" && Number(ok.rows?.[0]?.body_fat_pct) === 18.5 && ok.rows?.[0]?.activity_level === "light", JSON.stringify(ok));
      h.check("it leaves the client's phone, bio, units and portion setting alone", ok.rows?.[0]?.phone === "555-0100" && ok.rows?.[0]?.bio === "private bio" && ok.rows?.[0]?.weight_unit === "kg" && ok.rows?.[0]?.portion_units === "household", JSON.stringify(ok));
      const clear = await call(coach, [f, g, null, null, null, null, null, null, true]);
      h.check("a coach can clear the body fat number", !clear.error && clear.rows?.[0]?.body_fat_pct === null && Number(clear.rows?.[0]?.height_cm) === 178, JSON.stringify(clear));
      for (const [label, args] of [
        ["height under 90", [f, g, 50, null, null, null, null, null, false]],
        ["height over 250", [f, g, 300, null, null, null, null, null, false]],
        ["body fat over 60", [f, g, null, null, 70, null, null, null, false]],
        ["an unknown sex", [f, g, null, "x", null, null, null, null, false]],
        ["an unknown activity level", [f, g, null, null, null, "extreme", null, null, false]],
        ["an unknown unit", [f, g, null, null, null, null, "stone", null, false]],
      ]) {
        h.check(`the function refuses ${label}`, !!(await call(coach, args)).error);
      }
      await h.as(stranger);
      h.check("another organization's coach is refused", /Only a coach of this group/.test((await call(stranger, [f, g, 170, null, null, null, null, null, false])).error ?? ""));
      await h.as(coach2);
      h.check("a coach of the group who is asked about a person who is not its client is refused", /not a client in this group/.test((await call(coach2, [coach, g, 170, null, null, null, null, null, false])).error ?? ""));
      await h.as(f);
      h.check("the client themself cannot use the coach function", !!(await call(f, [f, g, 170, null, null, null, null, null, false])).error);
      await h.asSuper();
      const acl = await h.one(`select has_function_privilege('anon', 'public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean)', 'execute') as anon, has_function_privilege('authenticated', 'public.coach_set_body_profile(uuid, uuid, numeric, text, numeric, text, text, text, boolean)', 'execute') as auth`);
      h.check("the function is closed to the public and open to signed-in users", !acl.anon && acl.auth, JSON.stringify(acl));
      const gacl = await h.one(`select has_function_privilege('anon', 'public.guard_client_goal_update()', 'execute') as anon, has_function_privilege('authenticated', 'public.guard_client_goal_update()', 'execute') as auth`);
      h.check("rebuilding guard_client_goal_update left its permissions exactly as they were", gacl.anon === globalThis.__p2acl.anon && gacl.auth === globalThis.__p2acl.auth, JSON.stringify({ gacl, before: globalThis.__p2acl }));
      const open = await h.rows(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('clear_client_goal_phase_on_insert', 'phase_follows_confirmed_goal', 'notify_on_nutrition_baseline') and p.prorettype <> 'trigger'::regtype`);
      h.check("the three new trigger functions are trigger functions (nobody can call them directly)", open.length === 0, JSON.stringify(open));

      // ---- a baseline has no previous week ----
      const baselineSug = await tryQ(db, `insert into public.nutrition_checkin_suggestions (athlete_id, group_id, phase, current_calories, new_calories, rationale, protein_g, carbs_g, fat_g, diet_archetype, dietary_restrictions, status, kind, below_floor, consecutive_surplus_spikes) values ($1, $2, 'maintenance', null, 2400, 'Starting target', 170, 280, 70, 'standard', '', 'pending', 'baseline', false, 0) returning kind`, [f, g]);
      h.check("a baseline suggestion can be saved without a previous weight, calories, adherence or recovery rating", !baselineSug.error && baselineSug.rows?.[0]?.kind === "baseline", JSON.stringify(baselineSug));
      const weeklyBlank = await tryQ(db, `insert into public.nutrition_checkin_suggestions (athlete_id, group_id, phase, new_calories, rationale, protein_g, carbs_g, fat_g, diet_archetype, dietary_restrictions, status, kind, consecutive_surplus_spikes) values ($1, $2, 'maintenance', 2400, 'x', 170, 280, 70, 'standard', '', 'pending', 'weekly', 0)`, [f, g]);
      h.check("a WEEKLY suggestion still needs every one of those", /weekly_complete/.test(weeklyBlank.error ?? ""), JSON.stringify(weeklyBlank));
      const weeklyOk = await tryQ(db, `insert into public.nutrition_checkin_suggestions (${WEEKLY_COLS}) values ${weeklyVals(1)} returning kind`, [c, g]);
      h.check("a normal weekly suggestion is unchanged (kind defaults to weekly)", !weeklyOk.error && weeklyOk.rows?.[0]?.kind === "weekly", JSON.stringify(weeklyOk));
      h.check("an unknown kind is refused", /kind_ok/.test((await tryQ(db, `insert into public.nutrition_checkin_suggestions (${WEEKLY_COLS}, kind) values ${weeklyVals(1).replace(")", ", 'daily')")}`, [c, g])).error ?? ""));
      const baselineCheckin = await tryQ(db, `insert into public.nutrition_checkins (athlete_id, group_id, phase, new_calories, rationale, protein_g, carbs_g, fat_g, created_by, kind) values ($1, $2, 'maintenance', 2400, 'Starting target', 170, 280, 70, $3, 'baseline') returning kind`, [f, g, coach]);
      h.check("a baseline check-in record can be saved without a previous week", !baselineCheckin.error, JSON.stringify(baselineCheckin));
      const weeklyCheckinBlank = await tryQ(db, `insert into public.nutrition_checkins (athlete_id, group_id, phase, new_calories, rationale, protein_g, carbs_g, fat_g, created_by) values ($1, $2, 'maintenance', 2400, 'x', 170, 280, 70, $3)`, [f, g, coach]);
      h.check("a weekly check-in record still needs every value", /weekly_complete/.test(weeklyCheckinBlank.error ?? ""), JSON.stringify(weeklyCheckinBlank));
      await h.asSuper();
      const notes = await h.rows(`select profile_id, group_id, body, link_path from public.notifications where type = 'nutrition_baseline_ready' order by profile_id`);
      h.check("both coaches of the group are told a starting target is ready, with fixed wording and no numbers", notes.length === 2 && notes.some((n) => n.profile_id === coach) && notes.some((n) => n.profile_id === coach2) && notes.every((n) => n.body === "A starting target is ready for P2 Fresh Client" && !/2400|170/.test(n.body)), JSON.stringify(notes));
      h.check("the notice links to that client in Nutrition", notes.every((n) => n.link_path === `/groups/${g}/nutrition?athleteId=${f}`), JSON.stringify(notes));
      h.check("the client and another group's coach are not told, and a weekly suggestion sends no baseline notice", !notes.some((n) => n.profile_id === f || n.profile_id === stranger || n.profile_id === coach2 && n.group_id !== g));

      // ---- one notice per coach, not one per athlete ----
      const secondBaseline = async (athlete) =>
        db.query(`insert into public.nutrition_checkin_suggestions (athlete_id, group_id, phase, new_calories, rationale, protein_g, carbs_g, fat_g, diet_archetype, dietary_restrictions, status, kind, consecutive_surplus_spikes) values ($1, $2, 'maintenance', 2300, 'Starting target', 160, 260, 70, 'standard', '', 'pending', 'baseline', 0)`, [athlete, g]);
      await secondBaseline(a);
      await secondBaseline(c);
      const digest = await h.rows(`select profile_id, body, link_path, read_at from public.notifications where type = 'nutrition_baseline_ready' and group_id = $1 order by profile_id`, [g]);
      h.check("three athletes' starting targets leave each coach ONE notice, not three", digest.length === 2 && digest.some((n) => n.profile_id === coach) && digest.some((n) => n.profile_id === coach2), JSON.stringify(digest));
      h.check("the folded notice has fixed wording, no name and no number, and opens the Nutrition list", digest.every((n) => n.body === "Starting targets are ready for several clients" && n.link_path === `/groups/${g}/nutrition`), JSON.stringify(digest));
      await db.query(`update public.notifications set read_at = now() where type = 'nutrition_baseline_ready'`);
      const digestClient = await h.user("P2 Digest Client");
      await h.member(g, digestClient);
      await secondBaseline(digestClient);
      const fresh = await h.rows(`select body from public.notifications where type = 'nutrition_baseline_ready' and read_at is null and group_id = $1`, [g]);
      h.check("once the coach has read it, the next starting target makes a new single notice that names the client", fresh.length === 2 && fresh.every((n) => n.body === "A starting target is ready for P2 Digest Client"), JSON.stringify(fresh));

      // ---- a goal can carry a proposed phase; it becomes the phase of record only when the CLIENT confirms it ----
      const mk = async (who, athlete, phase, type = "muscle_gain", extra = "") =>
        (await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by, target_date, nutrition_phase${extra}) values ($1, $2, '${type}', 'proposed', $3, '2027-03-01', $4) returning id, nutrition_phase`, [athlete, g, who, phase]));
      const phaseOf = async (id) => (await h.one(`select nutrition_phase, status, created_by from public.client_goals where id = $1`, [id]));
      const planNow = async (x) => (await h.rows(`select phase, started_on::text as started_on, review_on from public.client_phase_plans where athlete_id = $1 and group_id = $2`, [x, g]))[0];
      const tag = async (x) => (await h.rows(`select phase from public.nutrition_phases where athlete_id = $1 and group_id = $2`, [x, g]))[0]?.phase ?? null;
      const today = (await h.one(`select current_date::text as d`)).d; // the database's own date (the machine's zone), not the UTC date, so the check holds at any hour

      await h.as(f);
      const clientOwn = await mk(f, f, "hypertrophy");
      h.check("a client's own goal never carries a phase (cleared on insert)", !clientOwn.error && clientOwn.rows?.[0]?.nutrition_phase === null, JSON.stringify(clientOwn));
      await h.as(coach);
      const coachGoal = await mk(coach, f, "reverse_diet", "custom", "");
      // custom goals may need a label; retry with one when the live shape asks for it
      let gid = coachGoal.rows?.[0]?.id;
      if (coachGoal.error) {
        const retry = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, custom_label, status, created_by, target_date, nutrition_phase) values ($1, $2, 'custom', 'Rebuild: reverse diet', 'proposed', $3, '2027-03-01', 'reverse_diet') returning id, nutrition_phase`, [f, g, coach]);
        gid = retry.rows?.[0]?.id;
      }
      h.check("a coach proposes a goal that carries a phase", !!gid && (await phaseOf(gid)).nutrition_phase === "reverse_diet", JSON.stringify(gid));
      await h.asSuper();
      h.check("a proposed goal does not move the phase of record", (await planNow(f)) === undefined && (await tag(f)) === null);
      await h.as(f);
      const counter = await tryQ(db, `update public.client_goals set target_date = '2027-06-01' where id = $1 returning nutrition_phase, created_by, status`, [gid]);
      await h.asSuper();
      h.check("a client's counter-proposal clears the phase and makes the client the author", counter.rows?.[0]?.nutrition_phase === null && counter.rows?.[0]?.created_by === f && counter.rows?.[0]?.status === "proposed", JSON.stringify(counter));
      await h.as(coach);
      const coachAgain = await tryQ(db, `update public.client_goals set nutrition_phase = 'hypertrophy' where id = $1 returning status, created_by, nutrition_phase`, [gid]);
      await h.asSuper();
      h.check("a coach putting a phase on it makes the coach the author again, so it goes back to the client", coachAgain.rows?.[0]?.created_by === coach && coachAgain.rows?.[0]?.status === "proposed" && coachAgain.rows?.[0]?.nutrition_phase === "hypertrophy", JSON.stringify(coachAgain));
      h.check("the phase of record still has not moved", (await planNow(f)) === undefined);
      await h.as(coach);
      const selfConfirm = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1`, [gid]);
      await h.asSuper();
      h.check("a coach cannot confirm it for the client, so the phase cannot move that way", /Only the client can confirm/.test(selfConfirm.error ?? "") && (await planNow(f)) === undefined, JSON.stringify(selfConfirm));
      await h.as(f);
      const sneaky = await tryQ(db, `update public.client_goals set status = 'confirmed', nutrition_phase = 'fat_loss' where id = $1 returning nutrition_phase, status, created_by`, [gid]);
      await h.asSuper();
      h.check("a client who changes the phase while answering has made a counter-proposal (phase cleared, goes back to the coach)", sneaky.rows?.[0]?.nutrition_phase === null && sneaky.rows?.[0]?.status === "proposed" && sneaky.rows?.[0]?.created_by === f, JSON.stringify(sneaky));
      h.check("and the phase of record still has not moved", (await planNow(f)) === undefined);
      // a fresh coach proposal, confirmed by the client
      await h.as(coach);
      const g2goal = await mk(coach, f, "fat_loss");
      const gid2 = g2goal.rows?.[0]?.id;
      await h.as(f);
      const confirm = await tryQ(db, `update public.client_goals set status = 'confirmed' where id = $1 returning status, nutrition_phase`, [gid2]);
      await h.asSuper();
      const plan = await planNow(f);
      h.check("the client confirms the coach's goal: the phase of record follows, from today, with no review date", confirm.rows?.[0]?.status === "confirmed" && plan?.phase === "fat_loss" && plan?.started_on === today && plan?.review_on === null, JSON.stringify({ confirm, plan }));
      h.check("the milestone tag the trend detectors read follows with the mapping (fat_loss is cut)", (await tag(f)) === "cut");
      // maintenance clears the tag
      await h.as(coach);
      const mGoal = await mk(coach, f, "maintenance", "body_recomp");
      await h.as(f);
      await db.query(`update public.client_goals set status = 'confirmed' where id = $1`, [mGoal.rows[0].id]);
      await h.asSuper();
      h.check("a confirmed maintenance goal sets maintenance and clears the milestone tag", (await planNow(f))?.phase === "maintenance" && (await tag(f)) === null, JSON.stringify(await planNow(f)));
      // a client who declines changes nothing
      await h.as(coach);
      const dGoal = await mk(coach, f, "hypertrophy");
      await h.as(f);
      await db.query(`update public.client_goals set status = 'declined' where id = $1`, [dGoal.rows[0].id]);
      await h.asSuper();
      h.check("a declined goal changes nothing", (await planNow(f))?.phase === "maintenance");
      // a goal the client authored and the coach confirms never moves the plan
      await h.as(f);
      const mine2 = await mk(f, f, null);
      await h.as(coach);
      await db.query(`update public.client_goals set status = 'confirmed' where id = $1`, [mine2.rows[0].id]);
      await h.asSuper();
      h.check("a goal the client wrote and the coach confirmed leaves the phase of record as it was", (await planNow(f))?.phase === "maintenance");
      // the server (service role) can still write a goal with a phase (the guard only restrains signed-in users)
      await h.asService();
      const svc = await tryQ(db, `insert into public.client_goals (athlete_id, group_id, goal_type, status, created_by, nutrition_phase) values ($1, $2, 'muscle_gain', 'proposed', $3, 'hypertrophy') returning nutrition_phase`, [f, g, coach]);
      await h.asSuper();
      h.check("the server can write a goal with a phase", svc.rows?.[0]?.nutrition_phase === "hypertrophy", JSON.stringify(svc));
      h.check("the phase column only holds the four engine phases", /nutrition_phase_ok/.test((await tryQ(db, `update public.client_goals set nutrition_phase = 'bulk' where id = $1`, [gid2])).error ?? ""));
      void org; void org2; void d; void e; void b; void g2;
    },
  },
};
