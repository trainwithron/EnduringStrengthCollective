import { NextResponse } from "next/server";
import { changeFromHere, moveOccurrence, skipOccurrence } from "@/lib/series-engine";
import { authorizeCoachCall, isResponse } from "@/lib/series-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Edit one session of a recurring schedule (move it, or take it off), or this session and every one after it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
  if (!bookingId) return NextResponse.json({ error: "Missing session." }, { status: 400 });

  // The group comes from the stored booking, never from the request.
  const { data: booking } = await createServiceRoleClient().from("bookings").select("group_id").eq("id", bookingId).maybeSingle();
  const call = await authorizeCoachCall(booking?.group_id ?? null);
  if (isResponse(call)) return call;

  const duration = body.durationMinutes != null ? Number(body.durationMinutes) : null;
  if (duration != null && (!Number.isFinite(duration) || duration < 5 || duration > 480)) {
    return NextResponse.json({ error: "Pick a session length between 5 minutes and 8 hours." }, { status: 400 });
  }

  let r: { ok: boolean; message: string };
  switch (body.action) {
    case "move":
      r = await moveOccurrence(call.store, bookingId, String(body.newStartIso ?? ""), duration);
      break;
    case "skip":
      r = await skipOccurrence(call.store, bookingId);
      break;
    case "change_from_here":
      r = await changeFromHere(call.store, bookingId, String(body.newStartIso ?? ""), duration);
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
