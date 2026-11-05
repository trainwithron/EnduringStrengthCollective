import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { requestAnswerLine } from "@/lib/notification-push";

// Confirm or Decline pressed on the phone notification itself (Ron, Nov 5: "make a confirm deny on the notification itself"). Called by the app's service worker with the coach's own sign-in; the database
// decides exactly as when the same buttons are pressed in the app (resolve_booking_request: only the client's coach, only a request still waiting, a time taken since is declined and the client told).
// A signed-out phone gets 401 and the worker opens the requests instead, so nothing is decided without the coach.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limited = await rateLimitResponse("booking-request-answer", user.id, 120, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { requestId?: unknown; confirm?: unknown };
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId || typeof body.confirm !== "boolean") return NextResponse.json({ error: "Missing the request." }, { status: 400 });

  const { data, error } = await supabase.rpc("resolve_booking_request", { p_request_id: requestId, p_confirm: body.confirm });
  if (error) {
    if (/already answered/i.test(error.message)) return NextResponse.json({ result: "already", line: requestAnswerLine("already") });
    if (/not authorized|not found/i.test(error.message)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    return NextResponse.json({ error: "That didn't save." }, { status: 500 });
  }
  const result = typeof data === "string" ? data : "confirmed";
  return NextResponse.json({ result, line: requestAnswerLine(result) });
}
