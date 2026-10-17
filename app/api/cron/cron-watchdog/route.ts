import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CRON_JOBS, MONITORING_STARTED, findStaleJobs, type CronRunRow } from "@/lib/cron-jobs";
import { alertPlatformAdmins, withCronRun } from "@/lib/cron-monitor";
import { pageAll } from "@/lib/page-all";
import { aiFeatureHealth, aiFeaturesToAlert, AI_ALERT_SHARE } from "@/lib/ai-health";

// Runs daily. Looks at every scheduled job's last run and tells the platform admin about any that is failing or has stopped
// running. A job that throws already alerts on its own; this catches the quiet failure, a job that is not being called at all.
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = createServiceRoleClient();
  const { data, error } = await db.from("cron_runs").select("job, last_success_at, last_status, consecutive_failures, updated_at");
  if (error) return NextResponse.json({ ok: true, skipped: "job monitoring is not set up yet" });

  const rows = (data ?? []) as (CronRunRow & { updated_at: string })[];
  // A job missing from the table is only "never run" after a grace period counted from when monitoring began.
  const stale = findStaleJobs(rows, new Date(), { since: MONITORING_STARTED });

  if (stale.length > 0) {
    const lines = stale.map((s) => `- ${s.job}: ${s.reason.replace(/_/g, " ")}${s.hoursSinceSuccess !== null ? ` (last success ${Math.round(s.hoursSinceSuccess)}h ago)` : ""}`);
    await alertPlatformAdmins(`${stale.length} scheduled ${stale.length === 1 ? "job needs" : "jobs need"} attention`, `These scheduled jobs are failing or have stopped running:\n${lines.join("\n")}`);
  }
  // AI calls over the last 24 hours (the job runs daily, so one bad afternoon is reported once, not every day for a week): a feature whose calls end cut off or failing more than 10 percent of the time (with at
  // least 10 calls) is reported. The read goes a page at a time, oldest first, because a request returns at most 1,000 rows.
  let aiAlerts: ReturnType<typeof aiFeaturesToAlert> = [];
  try {
    const since = new Date(Date.now() - 86400000).toISOString();
    const usage = await pageAll((from, to) => db.from("ai_usage_log").select("feature, status, created_at, user_id, coach_id").gte("created_at", since).order("created_at", { ascending: true }).order("id").range(from, to), { maxPages: 40 });
    if (!usage.failed) {
      aiAlerts = aiFeaturesToAlert(aiFeatureHealth(usage.rows as { feature: string; status: string; created_at: string; user_id: string | null; coach_id: string | null }[]));
      if (aiAlerts.length > 0) {
        const lines = aiAlerts.map((h) => `- ${h.feature}: ${h.notOk} of ${h.calls} calls did not finish (${Math.round(h.share * 100)} percent)`);
        await alertPlatformAdmins(`${aiAlerts.length} AI ${aiAlerts.length === 1 ? "feature is" : "features are"} failing more than ${Math.round(AI_ALERT_SHARE * 100)} percent of the time`, `In the last 24 hours:\n${lines.join("\n")}`);
      }
    }
  } catch {
    // the AI check never stops the job check
  }
  // Data health, nightly: a workout left "in progress" for a week means the stale-workout job is not doing its work (it closes them after three days).
  let staleOpenSessions = 0;
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count, error: healthError } = await db
      .from("athlete_sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_progress")
      .lt("started_at", cutoff);
    if (!healthError) {
      staleOpenSessions = count ?? 0;
      if (staleOpenSessions > 0) {
        await alertPlatformAdmins("Workouts are being left open", `${staleOpenSessions} workouts have been "in progress" for more than a week. The nightly close-stale-sessions job should have paused them.`);
      }
    }
  } catch {
    // the data check never stops the job check
  }
  return NextResponse.json({ ok: true, checked: CRON_JOBS.length, stale, aiAlerts, staleOpenSessions });
}

export const GET = withCronRun("cron-watchdog", handler);
