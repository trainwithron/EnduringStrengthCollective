import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findStaleJobs, type CronRunRow } from "@/lib/cron-jobs";

// A plain, unauthenticated status endpoint — for an external uptime
// monitor (UptimeRobot, Vercel's own status checks, etc.) to hit on a
// schedule, or for a quick manual check that the app can actually reach
// its database, not just that Next.js itself is up. Middleware allowlists
// this path the same way it already does for Stripe's webhook and the
// cron routes — no session is ever attached to a monitor's request.
//
// It also reports whether the scheduled jobs are running. "status" is "ok" when the database
// answers and every job is healthy, "degraded" (still 200) when the database answers but some job is
// failing or has stopped, and "error" (503) when the database does not answer. A monitor that checks
// for the word "ok" therefore also catches a stopped job. Only job names are shown, never details.
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = createServiceRoleClient();
    // Cheapest possible real round-trip to the database — not asking
    // anything about the data itself, just confirming the connection and
    // credentials actually work end to end.
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (error) throw error;

    let stale: { job: string; reason: string }[] = [];
    let monitoring = false;
    try {
      const { data, error: cronError } = await supabase.from("cron_runs").select("job, last_success_at, last_status, consecutive_failures, updated_at");
      if (!cronError && data && data.length > 0) {
        monitoring = true;
        const rows = data as (CronRunRow & { updated_at: string })[];
        const since = new Date(Math.min(...rows.map((r) => new Date(r.updated_at).getTime())));
        stale = findStaleJobs(rows, new Date(), { since }).map((s) => ({ job: s.job, reason: s.reason }));
      }
    } catch {
      // Job monitoring is not set up yet: report the database alone.
    }

    return NextResponse.json({
      status: stale.length > 0 ? "degraded" : "ok",
      database: "reachable",
      jobs: monitoring ? (stale.length > 0 ? { status: "attention", stale } : { status: "ok" }) : { status: "not monitored yet" },
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
