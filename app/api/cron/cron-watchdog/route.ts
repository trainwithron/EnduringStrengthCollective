import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CRON_JOBS, findStaleJobs, type CronRunRow } from "@/lib/cron-jobs";
import { alertPlatformAdmins, withCronRun } from "@/lib/cron-monitor";

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
  // Monitoring began when the oldest row was written; a job missing from the table is only "never run" after a grace period.
  const since = rows.length > 0 ? new Date(Math.min(...rows.map((r) => new Date(r.updated_at).getTime()))) : new Date();
  const stale = findStaleJobs(rows, new Date(), { since });

  if (stale.length > 0) {
    const lines = stale.map((s) => `- ${s.job}: ${s.reason.replace(/_/g, " ")}${s.hoursSinceSuccess !== null ? ` (last success ${Math.round(s.hoursSinceSuccess)}h ago)` : ""}`);
    await alertPlatformAdmins(`${stale.length} scheduled ${stale.length === 1 ? "job needs" : "jobs need"} attention`, `These scheduled jobs are failing or have stopped running:\n${lines.join("\n")}`);
  }
  return NextResponse.json({ ok: true, checked: CRON_JOBS.length, stale });
}

export const GET = withCronRun("cron-watchdog", handler);
