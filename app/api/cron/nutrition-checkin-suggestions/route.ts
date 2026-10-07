import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runCheckInEngine, DEFAULT_ADJUSTMENT_PCT, type NutritionPhase } from "@/lib/nutrition-checkin";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { computeReadinessAverage } from "@/lib/wellness";
import { computeArchetypeMacros, detectDietArchetype } from "@/lib/macros";
import { estimateMaintenance } from "@/lib/nutrition-profile";
import { withCronRun } from "@/lib/cron-monitor";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { addDaysToKey } from "@/lib/date-key";
import { summarizeAdherence } from "@/lib/food-log-adherence";
import { readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";
import { rowToPhasePlan } from "@/lib/phase-plan";
import { chooseBaselinePhase, computeBaseline } from "@/lib/nutrition-baseline";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { ageOnDate } from "@/lib/nutrition-profile";
import { holdDeficitForMinor } from "@/lib/minor-safety";

// Weekly Check-In engine, made proactive (nutrition_checkin_engine_scoping
// memory) — a coach shouldn't have to remember to open the panel and
// click "Run check-in" every week. Same CRON_SECRET/service-role pattern
// as coach-digest and milestone-scan. Runs the exact same pure engine the
// manual panel already calls, using the same real-data pre-fill (weekly
// weight trend, wellness-derived recovery default) — it just lands as a
// pending row a coach reviews and applies, never writing daily_macros
// directly. Nothing here is a new business rule.
//
// ADHERENCE is the number of the last 7 days (the client's own calendar days, as date keys in the group's coach time zone) on which the client logged at least
// one non-skipped meal. Under 5 of 7 the engine holds calories steady, which writes no suggestion (the coach screen shows "logged 2 of 7, held" from the logs).
//
// The PHASE a suggestion carries is the client's phase of record (client_phase_plans), else the latest check-in's phase. A review date never changes it: this job
// never proposes a phase change.
//
// A client with no check-in AND no standing target (the job used to skip them) gets a STARTING target suggestion once their About-you numbers are complete.

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // "An active tracked phase" is, concretely, an athlete with at least
  // one prior check-in — that's the only place this engine's own notion
  // of phase/continuation state (consecutive_surplus_spikes) is
  // persisted per athlete today. Take each athlete's single most recent
  // row as the continuation baseline.
  const { data: recentCheckins } = await supabase
    .from("nutrition_checkins")
    .select(
      "athlete_id, group_id, phase, new_calories, consecutive_surplus_spikes, dietary_restrictions, adjustment_pct, created_at"
    )
    .order("created_at", { ascending: false });

  interface RecentCheckinRow {
    athlete_id: string;
    group_id: string;
    phase: string;
    new_calories: number;
    consecutive_surplus_spikes: number;
    dietary_restrictions: string | null;
    adjustment_pct: number | null;
    created_at: string;
  }

  const latestByAthlete = new Map<string, RecentCheckinRow>();
  for (const row of (recentCheckins ?? []) as RecentCheckinRow[]) {
    if (!latestByAthlete.has(row.athlete_id)) latestByAthlete.set(row.athlete_id, row);
  }

  // Each group's own calendar day (the coach's zone), worked out once per group.
  const todayKeyByGroup = new Map<string, string>();
  const todayKeyFor = async (groupId: string): Promise<string> => {
    const cached = todayKeyByGroup.get(groupId);
    if (cached) return cached;
    const key = dateKeyInZone(await getGroupCoachTimezone(supabase, groupId));
    todayKeyByGroup.set(groupId, key);
    return key;
  };

  const { data: planRows } = await supabase.from("client_phase_plans").select("athlete_id, group_id, phase, started_on, review_on, planned_next_phase, last_reviewed_at");
  const planByKey = new Map<string, ReturnType<typeof rowToPhasePlan>>();
  for (const p of planRows ?? []) planByKey.set(`${p.athlete_id}|${p.group_id}`, rowToPhasePlan(p as Record<string, unknown>));

  const results: { athleteId: string; suggested: boolean; loggedDays?: number; held?: boolean }[] = [];

  for (const [athleteId, last] of latestByAthlete) {
    const todayKey = await todayKeyFor(last.group_id);
    const [
      { data: weightLogs },
      { data: wellnessRows },
      { data: injuryStatusRow },
      { data: profileDetails },
      { data: intake },
      { data: prefsRow },
      { data: foodRows },
    ] = await Promise.all([
      supabase
        .from("body_weight_logs")
        .select("logged_date, weight")
        .eq("athlete_id", athleteId)
        .eq("group_id", last.group_id)
        .order("logged_date", { ascending: false })
        .limit(20),
      supabase
        .from("wellness_checkins")
        .select("sleep_quality, soreness, energy")
        .eq("athlete_id", athleteId)
        .eq("group_id", last.group_id)
        .gte("log_date", addDaysToKey(todayKey, -7)),
      // coach_em_up_finley_funston_transcript.md — same real
      // client-safety gap as the two other runCheckInEngine call sites
      // (WeeklyCheckinPanel, MealPlanGenerator): the automated digest was
      // never checking this, so an injured client's phase-computed cut
      // would apply here with no maintenance floor at all.
      supabase
        .from("athlete_injury_status")
        .select("is_injured, surplus_pct")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
      supabase.from("athlete_profile_details").select("*").eq("athlete_id", athleteId).maybeSingle(),
      supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
      // The client's own protein target (a missing row, or a database without the table yet, just means the platform default).
      supabase.from("client_nutrition_preferences").select("protein_g_per_lb").eq("athlete_id", athleteId).maybeSingle(),
      // The meals they logged in the last 7 days: the real adherence.
      supabase
        .from("food_log_entries")
        .select("log_date, status")
        .eq("athlete_id", athleteId)
        .gte("log_date", addDaysToKey(todayKey, -6))
        .lte("log_date", todayKey),
    ]);

    const trend = computeWeeklyWeightTrend(
      (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
      todayKey
    );
    if (trend.currentAvg == null || trend.previousAvg == null) {
      results.push({ athleteId, suggested: false });
      continue;
    }

    let recoveryRating = 3;
    if (wellnessRows && wellnessRows.length > 0) {
      const avg =
        wellnessRows.reduce(
          (sum, w) =>
            sum + computeReadinessAverage({ sleepQuality: w.sleep_quality, soreness: w.soreness, energy: w.energy }),
          0
        ) / wellnessRows.length;
      recoveryRating = Math.min(5, Math.max(1, Math.round(avg)));
    }

    // Same BMR/maintenance estimate used at every other runCheckInEngine call site — only computed when every real input actually exists, never a guessed number
    // backing a safety floor. The date of birth comes from the one reader (the intake's, else the profile's), and activity is the client's own when given.
    const body = rowToBodyProfile(profileDetails as Record<string, unknown> | null, intake as Record<string, unknown> | null);
    const maintenanceCalories = estimateMaintenance({
      weightLbs: trend.currentAvg,
      heightCm: body.heightCm,
      sex: body.sex,
      dateOfBirth: readDateOfBirth(body),
      bodyFatPct: body.bodyFatPct,
      todayKey,
      activity: body.activity,
    });

    const adherence = summarizeAdherence((foodRows ?? []) as { log_date: string; status: string | null }[], todayKey);
    // The phase of record, else the latest check-in's: a review date never changes it.
    const phase = (planByKey.get(`${athleteId}|${last.group_id}`)?.phase ?? last.phase) as NutritionPhase;

    const rawResult = runCheckInEngine({
      phase,
      prevWeightLbs: trend.previousAvg,
      currWeightLbs: trend.currentAvg,
      currentCalories: last.new_calories,
      adherenceDays: adherence.daysLogged,
      recoveryRating,
      consecutiveSurplusSpikes: last.consecutive_surplus_spikes,
      adjustmentPct: last.adjustment_pct ?? DEFAULT_ADJUSTMENT_PCT,
      isInjured: injuryStatusRow?.is_injured ?? false,
      maintenanceCalories,
      injurySurplusPct: injuryStatusRow?.surplus_pct ?? 0,
    });
    // No calorie deficit is suggested for anyone under 18: a cut is held at their current calories, which writes no suggestion.
    const dob = readDateOfBirth(body);
    const { result: engineResult } = holdDeficitForMinor({ ageYears: dob ? ageOnDate(dob, todayKey) : null, currentCalories: last.new_calories, result: rawResult });

    // Only a real, actionable recommendation is worth a coach's
    // attention — an "on track, hold steady" week (or a week held for low logging) would just be
    // per-athlete-per-week noise in a review inbox otherwise.
    if (engineResult.newCalories === last.new_calories) {
      results.push({ athleteId, suggested: false, loggedDays: adherence.daysLogged, held: adherence.heldForLowLogging });
      continue;
    }

    const archetype = detectDietArchetype(last.dietary_restrictions);
    const clientProteinGPerLb = prefsRow?.protein_g_per_lb != null ? Number(prefsRow.protein_g_per_lb) : undefined;
    const macros = computeArchetypeMacros(engineResult.newCalories, trend.currentAvg, archetype, clientProteinGPerLb);

    await supabase.from("nutrition_checkin_suggestions").insert({
      athlete_id: athleteId,
      group_id: last.group_id,
      phase,
      prev_weight_lbs: trend.previousAvg,
      curr_weight_lbs: trend.currentAvg,
      current_calories: last.new_calories,
      adherence_days: adherence.daysLogged,
      recovery_rating: recoveryRating,
      consecutive_surplus_spikes: engineResult.consecutiveSurplusSpikes,
      new_calories: engineResult.newCalories,
      rationale: engineResult.rationale,
      protein_g: macros.proteinG,
      carbs_g: macros.carbsG,
      fat_g: macros.fatG,
      adjustment_pct: last.adjustment_pct ?? DEFAULT_ADJUSTMENT_PCT,
      diet_archetype: archetype,
      dietary_restrictions: last.dietary_restrictions ?? "",
    });
    results.push({ athleteId, suggested: true, loggedDays: adherence.daysLogged, held: adherence.heldForLowLogging });
  }

  const baselines = await seedBaselines(supabase, latestByAthlete, planByKey, todayKeyFor);
  return NextResponse.json({ athletes: results.length, results, baselinesSuggested: baselines });
}

// A starting target for clients who have no check-in and no standing target yet, once their numbers are complete. At most one per client and group, ever: a
// baseline the coach dismissed is not made again. Groups where the client is group-tier (no macros) are skipped. A cap keeps one run bounded.
const MAX_BASELINES_PER_RUN = 200;

async function seedBaselines(
  supabase: ReturnType<typeof createServiceRoleClient>,
  checkedAthletes: Map<string, unknown>,
  planByKey: Map<string, ReturnType<typeof rowToPhasePlan>>,
  todayKeyFor: (groupId: string) => Promise<string>
): Promise<number> {
  const [{ data: members }, { data: standingRows }, { data: baselineRows }] = await Promise.all([
    supabase.from("group_memberships").select("profile_id, group_id, client_tier").eq("role", "athlete"),
    supabase.from("client_macro_target_history").select("athlete_id, group_id"),
    supabase.from("nutrition_checkin_suggestions").select("athlete_id, group_id").eq("kind", "baseline"),
  ]);
  const hasStanding = new Set((standingRows ?? []).map((r) => `${r.athlete_id}|${r.group_id}`));
  const hadBaseline = new Set((baselineRows ?? []).map((r) => `${r.athlete_id}|${r.group_id}`));
  let made = 0;
  for (const m of members ?? []) {
    if (made >= MAX_BASELINES_PER_RUN) break;
    const key = `${m.profile_id}|${m.group_id}`;
    if (m.client_tier === "group" || checkedAthletes.has(m.profile_id) || hasStanding.has(key) || hadBaseline.has(key)) continue;
    const todayKey = await todayKeyFor(m.group_id);
    const [{ data: details }, { data: intake }, { data: weightRow }, { data: prefsRow }, { data: goalRows }] = await Promise.all([
      supabase.from("athlete_profile_details").select("*").eq("athlete_id", m.profile_id).maybeSingle(),
      supabase.from("client_intake").select("date_of_birth").eq("athlete_id", m.profile_id).maybeSingle(),
      supabase.from("body_weight_logs").select("weight").eq("athlete_id", m.profile_id).order("logged_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", m.profile_id).maybeSingle(),
      supabase.from("client_goals").select("goal_type, status, nutrition_phase, created_at").eq("athlete_id", m.profile_id).eq("group_id", m.group_id),
    ]);
    const body = rowToBodyProfile(details as Record<string, unknown> | null, intake as Record<string, unknown> | null);
    const prefs = rowToPreferences(prefsRow as Record<string, unknown> | null);
    const chosen = chooseBaselinePhase(planByKey.get(key) ?? null, (goalRows ?? []) as { goal_type: string; status: string; nutrition_phase?: string | null; created_at?: string | null }[]);
    const outcome = computeBaseline({
      weightLbs: weightRow?.weight != null ? Number(weightRow.weight) : null,
      heightCm: body.heightCm,
      sex: body.sex,
      dateOfBirth: readDateOfBirth(body),
      bodyFatPct: body.bodyFatPct,
      activity: body.activity,
      phase: chosen.phase,
      todayKey,
      proteinGPerLb: prefs.proteinGPerLb,
      carbSplit: prefs.carbSplit,
      dietType: prefs.dietType,
    });
    // Incomplete numbers: nothing is made (and nothing is guessed); the coach screen says what is missing.
    if (!outcome.ok) continue;
    const { error } = await supabase.from("nutrition_checkin_suggestions").insert({
      athlete_id: m.profile_id,
      group_id: m.group_id,
      phase: outcome.phase,
      new_calories: outcome.calories,
      rationale: outcome.rationale,
      protein_g: outcome.proteinG,
      carbs_g: outcome.carbsG,
      fat_g: outcome.fatG,
      diet_archetype: prefs.dietType === "keto" ? "keto" : prefs.dietType === "carnivore" ? "carnivore" : "standard",
      dietary_restrictions: "",
      status: "pending",
      kind: "baseline",
      below_floor: outcome.belowFloor,
      consecutive_surplus_spikes: 0,
    });
    if (!error) made++;
  }
  return made;
}

export const GET = withCronRun("nutrition-checkin-suggestions", handler);
