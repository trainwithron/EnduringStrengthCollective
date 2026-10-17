import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";

// Triggered daily by the Vercel Cron entry in vercel.json (CRON_SECRET header, like every other job). A workout still "in progress" three days after it was started was left open by mistake: it is set to
// paused (the same state as Pause for later, so the client can still resume it) so it stops counting as a live workout and stops holding screens and counts open.
const STALE_SESSION_DAYS = 3;

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("close_stale_sessions", { p_days: STALE_SESSION_DAYS });
  if (error) {
    console.error("close-stale-sessions failed:", error.message);
    return NextResponse.json({ error: "Could not close the stale workouts." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, closed: typeof data === "number" ? data : 0 });
}

export const GET = withCronRun("close-stale-sessions", handler);
