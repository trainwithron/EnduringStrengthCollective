import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToProfile } from "@/lib/send-push";
import { computeReverseDietMilestone } from "@/lib/metabolic-trend";
import { computeRecoveryVolumeMilestone } from "@/lib/recovery-volume-milestone";
import { computeReadinessAverage } from "@/lib/wellness";

// Milestone Celebrations — weekly scan for both trend-based detectors
// sharing this thread's one dual-trend engine (lib/metabolic-trend.ts's
// computeWindowedAverage): the reverse-diet flagship (coach-tag gated)
// and the "recovering better while lifting heavier" fast-follow (no tag
// needed — no equivalent false-positive risk to guard against). Same
// CRON_SECRET + service-role pattern as app/api/cron/coach-digest/route.ts
// and app/api/oura/sync/route.ts.

const REVERSE_DIET_WINDOW_WEEKS = 6;
const RECOVERY_VOLUME_WINDOW_WEEKS = 4;
const COOLDOWN_WEEKS = 8; // don't refire the same athlete+type again this soon

async function recordMilestone(
  supabase: SupabaseClient,
  athleteId: string,
  groupId: string,
  milestoneType: "reverse_diet" | "recovery_volume",
  detail: Record<string, unknown>,
  athleteBody: string,
  coachBody: string
): Promise<boolean> {
  const { data: inserted } = await supabase
    .from("milestone_events")
    .insert({ athlete_id: athleteId, group_id: groupId, milestone_type: milestoneType, detail })
    .select("id")
    .single();
  if (!inserted) return false;

  const { data: coachRow } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  const linkPath = `/share/milestone/${inserted.id}`;

  await supabase.from("notifications").insert([
    { profile_id: athleteId, group_id: groupId, type: "milestone_celebration", body: athleteBody, link_path: linkPath },
    ...(coachRow
      ? [
          {
            profile_id: coachRow.profile_id,
            group_id: groupId,
            type: "milestone_celebration",
            body: coachBody,
            link_path: linkPath,
          },
        ]
      : []),
  ]);

  await sendPushToProfile(supabase, athleteId, "Milestone reached", athleteBody, linkPath);
  if (coachRow) {
    await sendPushToProfile(supabase, coachRow.profile_id, "Client milestone", coachBody, linkPath);
  }
  return true;
}

async function alreadyFiredRecently(
  supabase: SupabaseClient,
  athleteId: string,
  milestoneType: string,
  now: Date
): Promise<boolean> {
  const cooldownStart = new Date(now);
  cooldownStart.setDate(cooldownStart.getDate() - COOLDOWN_WEEKS * 7);
  const { data } = await supabase
    .from("milestone_events")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("milestone_type", milestoneType)
    .gte("detected_at", cooldownStart.toISOString())
    .limit(1);
  return !!(data && data.length > 0);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();

  let reverseDietScanned = 0;
  let reverseDietDetected = 0;
  let recoveryVolumeScanned = 0;
  let recoveryVolumeDetected = 0;

  // --- Reverse-diet flagship: only coach-tagged athletes ---
  const phaseCutoff = new Date(now);
  phaseCutoff.setDate(phaseCutoff.getDate() - REVERSE_DIET_WINDOW_WEEKS * 7);

  const { data: taggedRows } = await supabase
    .from("nutrition_phases")
    .select("athlete_id, group_id, started_at")
    .eq("phase", "reverse_diet")
    .lte("started_at", phaseCutoff.toISOString().slice(0, 10));

  for (const row of taggedRows ?? []) {
    reverseDietScanned += 1;
    if (await alreadyFiredRecently(supabase, row.athlete_id, "reverse_diet", now)) continue;

    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - REVERSE_DIET_WINDOW_WEEKS * 7);

    const { data: macroRows } = await supabase
      .from("daily_macros")
      .select("log_date, calories")
      .eq("athlete_id", row.athlete_id)
      .eq("group_id", row.group_id)
      .gte("log_date", windowStart.toISOString().slice(0, 10));
    const { data: weightRows } = await supabase
      .from("body_weight_logs")
      .select("logged_date, weight")
      .eq("athlete_id", row.athlete_id)
      .eq("group_id", row.group_id)
      .gte("logged_date", windowStart.toISOString().slice(0, 10));

    const calorieSeries = (macroRows ?? [])
      .filter((r) => r.calories != null)
      .map((r) => ({ date: r.log_date as string, value: r.calories as number }));
    const weightSeries = (weightRows ?? []).map((r) => ({
      date: r.logged_date as string,
      value: r.weight as number,
    }));

    const result = computeReverseDietMilestone(calorieSeries, weightSeries, now, REVERSE_DIET_WINDOW_WEEKS);
    if (!result || !result.qualifies) continue;

    const fired = await recordMilestone(
      supabase,
      row.athlete_id,
      row.group_id,
      "reverse_diet",
      {
        calorieIncrease: result.calorieIncrease,
        weightChangePct: result.weightChangePct,
        weeklyExpectedGainLbs: result.weeklyExpectedGainLbs,
        windowWeeks: REVERSE_DIET_WINDOW_WEEKS,
      },
      "Your metabolism adapted — calories up, weight held. This is the reverse diet working.",
      "A tagged athlete just hit their reverse-diet milestone."
    );
    if (fired) reverseDietDetected += 1;
  }

  // --- Recovery-volume fast-follow: every athlete, no tag needed ---
  const recoveryWindowStart = new Date(now);
  recoveryWindowStart.setDate(recoveryWindowStart.getDate() - RECOVERY_VOLUME_WINDOW_WEEKS * 7);

  const { data: athleteRows } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id")
    .eq("role", "athlete");

  for (const row of athleteRows ?? []) {
    recoveryVolumeScanned += 1;
    if (await alreadyFiredRecently(supabase, row.profile_id, "recovery_volume", now)) continue;

    const { data: checkinRows } = await supabase
      .from("wellness_checkins")
      .select("log_date, sleep_quality, soreness, energy")
      .eq("athlete_id", row.profile_id)
      .eq("group_id", row.group_id)
      .gte("log_date", recoveryWindowStart.toISOString().slice(0, 10));
    const { data: workoutLogRows } = await supabase
      .from("workout_logs")
      .select("created_at, total_volume")
      .eq("athlete_id", row.profile_id)
      .eq("group_id", row.group_id)
      .gte("created_at", recoveryWindowStart.toISOString());

    const readinessSeries = (checkinRows ?? []).map((r) => ({
      date: r.log_date as string,
      value: computeReadinessAverage({ sleepQuality: r.sleep_quality, soreness: r.soreness, energy: r.energy }),
    }));
    const volumeSeries = (workoutLogRows ?? [])
      .filter((r) => r.total_volume != null)
      .map((r) => ({
        date: (r.created_at as string).slice(0, 10),
        value: r.total_volume as number,
      }));

    const result = computeRecoveryVolumeMilestone(
      readinessSeries,
      volumeSeries,
      now,
      RECOVERY_VOLUME_WINDOW_WEEKS
    );
    if (!result || !result.qualifies) continue;

    const fired = await recordMilestone(
      supabase,
      row.profile_id,
      row.group_id,
      "recovery_volume",
      {
        readinessChangePct: result.readinessChangePct,
        volumeChangePct: result.volumeChangePct,
        windowWeeks: RECOVERY_VOLUME_WINDOW_WEEKS,
      },
      "You're lifting more AND recovering better — that's the combination that actually works.",
      "Your athlete is training harder while recovering better — worth a shoutout."
    );
    if (fired) recoveryVolumeDetected += 1;
  }

  return NextResponse.json({
    reverseDietScanned,
    reverseDietDetected,
    recoveryVolumeScanned,
    recoveryVolumeDetected,
  });
}
