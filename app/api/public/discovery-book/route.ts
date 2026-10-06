import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { clientIp, rateLimitAllows } from "@/lib/rate-limit";
import { validateDiscoveryBooking } from "@/lib/public-forms";

// A visitor books a discovery call with a coach (no account). The database function used to be callable straight from the visitor's
// browser by anyone, with any coach id, at any time, as often as they liked. Now this route checks the request first, limits how often
// one address and one email can ask, makes sure the person is really a coach, then calls the function with the server's own access.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const checked = validateDiscoveryBooking(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const v = checked.value;

  if (!(await rateLimitAllows(`discovery-ip:${clientIp(request)}`, 8, 3600))) {
    return NextResponse.json({ error: "Too many requests. Please try again in a little while." }, { status: 429 });
  }
  if (!(await rateLimitAllows(`discovery-email:${v.email}`, 3, 86400))) {
    return NextResponse.json({ error: "Too many requests for that email. Please try again tomorrow." }, { status: 429 });
  }
  if (!(await rateLimitAllows(`discovery-coach:${v.coachId}`, 40, 3600))) {
    return NextResponse.json({ error: "This page is busy right now. Please try again in a little while." }, { status: 429 });
  }

  const db = createServiceRoleClient();
  // Only a real coach can be booked (any profile id used to be accepted).
  const { data: coachRow } = await db.from("group_memberships").select("profile_id").eq("profile_id", v.coachId).eq("role", "coach").limit(1).maybeSingle();
  if (!coachRow) return NextResponse.json({ error: "This booking link isn't valid." }, { status: 404 });

  const { error } = await db.rpc("book_discovery_call", {
    p_coach_id: v.coachId,
    p_start_at: v.startAt,
    p_end_at: v.endAt,
    p_prospect_name: v.name,
    p_prospect_email: v.email,
    p_prospect_phone: v.phone,
    p_message: v.message,
  });
  if (error) {
    if (/just taken/i.test(error.message)) return NextResponse.json({ error: "That time was just taken. Pick another slot." }, { status: 409 });
    console.error("book_discovery_call failed:", error.message);
    return NextResponse.json({ error: "We couldn't book that call. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
