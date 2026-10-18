import { NextResponse } from "next/server";
import { readHealth } from "@/lib/health-check";

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
// (The reading itself is lib/health-check.ts, which the public status page shows too.)
export async function GET() {
  const reading = await readHealth();
  return NextResponse.json(reading.body, reading.httpStatus === 200 ? undefined : { status: reading.httpStatus });
}
