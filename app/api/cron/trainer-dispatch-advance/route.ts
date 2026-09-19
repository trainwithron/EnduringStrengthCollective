import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isStepOverdue } from "@/lib/trainer-dispatch";
import { advanceDispatch } from "@/lib/trainer-dispatch-advance";

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — the
// TTL-then-advance mechanic for the cascade, matching the established
// "select overdue rows → act → stamp new state" shape already used by
// /api/cron/session-reminder and /api/cron/webhook-retry. Runs every 5
// minutes (vercel.json) rather than those two routes' 15-minute
// interval, since dispatch_ttl_minutes is org-configurable and could be
// set well under 15.
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

  const { data: pendingSteps } = await supabase
    .from("org_trainer_dispatch_steps")
    .select("id, request_id, expires_at")
    .eq("status", "pending");

  let advanced = 0;
  for (const step of pendingSteps ?? []) {
    if (!isStepOverdue(new Date(step.expires_at), now)) continue;
    await supabase
      .from("org_trainer_dispatch_steps")
      .update({ status: "expired", responded_at: now.toISOString() })
      .eq("id", step.id);
    await advanceDispatch(supabase, step.request_id);
    advanced++;
  }

  return NextResponse.json({ checked: (pendingSteps ?? []).length, advanced });
}
