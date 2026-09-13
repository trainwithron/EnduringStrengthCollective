import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runCheckInEngine, type NutritionPhase } from "@/lib/nutrition-checkin";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { computeReadinessAverage } from "@/lib/wellness";
import { computeArchetypeMacros, detectDietArchetype } from "@/lib/macros";

// Weekly Check-In engine, made proactive (nutrition_checkin_engine_scoping
// memory) — a coach shouldn't have to remember to open the panel and
// click "Run check-in" every week. Same CRON_SECRET/service-role pattern
// as coach-digest and milestone-scan. Runs the exact same pure engine the
// manual panel already calls, using the same real-data pre-fill (weekly
// weight trend, wellness-derived recovery default) — it just lands as a
// pending row a coach reviews and applies, never writing daily_macros
// directly. Nothing here is a new business rule.
//
// "Adherence" stays the one deliberately-manual input in the manual
// panel, but there's no coach present in a headless cron to ask — so
// this defaults to full compliance (7/7) rather than guessing at a
// missing signal. The coach still sees the full inputs (including
// weight trend) before applying, and can always run a fresh manual
// check-in with a real adherence number instead of applying this one.
const AUTOMATED_ADHERENCE_DAYS = 7;

export async function GET(request: Request) {
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
      "athlete_id, group_id, phase, new_calories, consecutive_surplus_spikes, dietary_restrictions, created_at"
    )
    .order("created_at", { ascending: false });

  interface RecentCheckinRow {
    athlete_id: string;
    group_id: string;
    phase: string;
    new_calories: number;
    consecutive_surplus_spikes: number;
    dietary_restrictions: string | null;
    created_at: string;
  }

  const latestByAthlete = new Map<string, RecentCheckinRow>();
  for (const row of (recentCheckins ?? []) as RecentCheckinRow[]) {
    if (!latestByAthlete.has(row.athlete_id)) latestByAthlete.set(row.athlete_id, row);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const results: { athleteId: string; suggested: boolean }[] = [];

  for (const [athleteId, last] of latestByAthlete) {
    const [{ data: weightLogs }, { data: wellnessRows }] = await Promise.all([
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
        .gte("log_date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
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

    const engineResult = runCheckInEngine({
      phase: last.phase as NutritionPhase,
      prevWeightLbs: trend.previousAvg,
      currWeightLbs: trend.currentAvg,
      currentCalories: last.new_calories,
      adherenceDays: AUTOMATED_ADHERENCE_DAYS,
      recoveryRating,
      consecutiveSurplusSpikes: last.consecutive_surplus_spikes,
    });

    // Only a real, actionable recommendation is worth a coach's
    // attention — an "on track, hold steady" week would just be
    // per-athlete-per-week noise in a review inbox otherwise.
    if (engineResult.newCalories === last.new_calories) {
      results.push({ athleteId, suggested: false });
      continue;
    }

    const archetype = detectDietArchetype(last.dietary_restrictions);
    const macros = computeArchetypeMacros(engineResult.newCalories, trend.currentAvg, archetype);

    await supabase.from("nutrition_checkin_suggestions").insert({
      athlete_id: athleteId,
      group_id: last.group_id,
      phase: last.phase,
      prev_weight_lbs: trend.previousAvg,
      curr_weight_lbs: trend.currentAvg,
      current_calories: last.new_calories,
      adherence_days: AUTOMATED_ADHERENCE_DAYS,
      recovery_rating: recoveryRating,
      consecutive_surplus_spikes: engineResult.consecutiveSurplusSpikes,
      new_calories: engineResult.newCalories,
      rationale: engineResult.rationale,
      protein_g: macros.proteinG,
      carbs_g: macros.carbsG,
      fat_g: macros.fatG,
      diet_archetype: archetype,
      dietary_restrictions: last.dietary_restrictions ?? "",
    });
    results.push({ athleteId, suggested: true });
  }

  return NextResponse.json({ athletes: results.length, results });
}
