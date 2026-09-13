import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// A plain, unauthenticated status endpoint — for an external uptime
// monitor (UptimeRobot, Vercel's own status checks, etc.) to hit on a
// schedule, or for a quick manual check that the app can actually reach
// its database, not just that Next.js itself is up. Middleware allowlists
// this path the same way it already does for Stripe's webhook and the
// cron routes — no session is ever attached to a monitor's request.
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = createServiceRoleClient();
    // Cheapest possible real round-trip to the database — not asking
    // anything about the data itself, just confirming the connection and
    // credentials actually work end to end.
    const { error } = await supabase.from("profiles").select("id").limit(1);
    if (error) throw error;

    return NextResponse.json({
      status: "ok",
      database: "reachable",
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
