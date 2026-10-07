import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { supabaseSeriesStore } from "@/lib/series-store";
import { applyRequestNow } from "@/lib/schedule-requests";

// A coach (or an org owner or admin) handles a client's schedule request: Done applies it (allowed on or after the day the client chose, the database refuses earlier),
// Handled marks it dealt with WITHOUT changing the schedule. A client never reaches this: they ask, withdraw and read through the database directly.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("schedule-request", user.id, 120, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const requestId = typeof body?.requestId === "string" ? body.requestId : null;
  const action = body?.action;
  if (!requestId || (action !== "done" && action !== "handled")) return NextResponse.json({ error: "Missing request." }, { status: 400 });

  // The request is read with the person's own session, so row security decides whether they can see it at all.
  const { data: row } = await supabase.from("schedule_requests").select("id, group_id, status").eq("id", requestId).maybeSingle();
  if (!row) return NextResponse.json({ error: "That request was not found." }, { status: 404 });

  const [{ data: isCoach }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("is_group_coach", { _group_id: row.group_id }),
    supabase.rpc("is_org_admin_of_group", { _group_id: row.group_id }),
  ]);
  if (!isCoach && !isAdmin) return NextResponse.json({ error: "Only the coach can handle this." }, { status: 403 });

  if (action === "handled") {
    const { error } = await supabase.rpc("dismiss_schedule_request", { p_request_id: requestId });
    if (error) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ ok: true, message: "Marked as handled." });
  }

  const db = createServiceRoleClient();
  const result = await applyRequestNow(db, supabaseSeriesStore(db), requestId);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
