import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { computeReverseDietMilestone } from "@/lib/metabolic-trend";

// Milestone Celebrations, flagship — weekly scan for the reverse-diet /
// metabolic-adaptation milestone. Same CRON_SECRET + service-role
// pattern as app/api/cron/coach-digest/route.ts and app/api/oura/sync/route.ts.
// Only ever evaluates an athlete the coach has explicitly tagged in
// nutrition_phases (Ron's own confirmed decision — never fires on the
// pattern alone).

const WINDOW_WEEKS = 6;
const COOLDOWN_WEEKS = 8; // don't refire the same athlete+type again this soon

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

  const phaseCutoff = new Date(now);
  phaseCutoff.setDate(phaseCutoff.getDate() - WINDOW_WEEKS * 7);

  const { data: taggedRows } = await supabase
    .from("nutrition_phases")
    .select("athlete_id, group_id, started_at")
    .eq("phase", "reverse_diet")
    .lte("started_at", phaseCutoff.toISOString().slice(0, 10));

  let detected = 0;
  let scanned = 0;

  for (const row of taggedRows ?? []) {
    scanned += 1;

    const cooldownStart = new Date(now);
    cooldownStart.setDate(cooldownStart.getDate() - COOLDOWN_WEEKS * 7);
    const { data: recentEvents } = await supabase
      .from("milestone_events")
      .select("id")
      .eq("athlete_id", row.athlete_id)
      .eq("milestone_type", "reverse_diet")
      .gte("detected_at", cooldownStart.toISOString())
      .limit(1);
    if (recentEvents && recentEvents.length > 0) continue;

    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - WINDOW_WEEKS * 7);

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

    const result = computeReverseDietMilestone(calorieSeries, weightSeries, now, WINDOW_WEEKS);
    if (!result || !result.qualifies) continue;

    const { data: inserted } = await supabase
      .from("milestone_events")
      .insert({
        athlete_id: row.athlete_id,
        group_id: row.group_id,
        milestone_type: "reverse_diet",
        detail: {
          calorieIncrease: result.calorieIncrease,
          weightChangePct: result.weightChangePct,
          weeklyExpectedGainLbs: result.weeklyExpectedGainLbs,
          windowWeeks: WINDOW_WEEKS,
        },
      })
      .select("id")
      .single();
    if (!inserted) continue;
    detected += 1;

    const { data: coachRow } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", row.group_id)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();

    const linkPath = `/share/milestone/${inserted.id}`;
    const body =
      "Your metabolism adapted — calories up, weight held. This is the reverse diet working.";
    const coachBody = "A tagged athlete just hit their reverse-diet milestone.";

    await supabase.from("notifications").insert([
      {
        profile_id: row.athlete_id,
        group_id: row.group_id,
        type: "milestone_celebration",
        body,
        link_path: linkPath,
      },
      ...(coachRow
        ? [
            {
              profile_id: coachRow.profile_id,
              group_id: row.group_id,
              type: "milestone_celebration",
              body: coachBody,
              link_path: linkPath,
            },
          ]
        : []),
    ]);

    await sendPushToProfile(supabase, row.athlete_id, "Milestone reached", body, linkPath);
    if (coachRow) {
      await sendPushToProfile(supabase, coachRow.profile_id, "Client milestone", coachBody, linkPath);
    }
  }

  return NextResponse.json({ scanned, detected });
}
