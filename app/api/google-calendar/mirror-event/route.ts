import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mirrorBookingToGoogleCalendar } from "@/lib/google-calendar-mirror-server";

// Called fire-and-forget from the browser right after book_session/
// reschedule_booking/cancel_booking_and_refund_credit succeeds (same
// "never block the booking flow on a notification round trip" pattern
// as lib/notify-booking-confirmed.ts) — mirrors that one booking into
// the coach's Google work calendar if they've connected one. A coach
// who hasn't connected Google Calendar makes this a silent no-op, not
// an error; nothing here is a load-bearing part of the booking flow
// itself. The mirroring itself lives in lib/google-calendar-mirror-server.ts
// so recurring sessions can reuse it from the server.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const bookingId = body?.bookingId;
  if (typeof bookingId !== "string") {
    return NextResponse.json({ error: "Missing bookingId." }, { status: 400 });
  }

  const serviceRole = createServiceRoleClient();
  const { data: booking } = await serviceRole.from("bookings").select("id, coach_id, athlete_id").eq("id", bookingId).maybeSingle();
  if (!booking) return NextResponse.json({ skipped: "booking not found" });

  // Real authorization check — this route reaches a coach's stored
  // Google OAuth token via the service-role client, so it must verify
  // the caller actually has standing on this specific booking rather
  // than trusting bookingId alone.
  if (user.id !== booking.coach_id && user.id !== booking.athlete_id) {
    return NextResponse.json({ error: "Not authorized for this booking." }, { status: 403 });
  }

  // Never surface a mirror failure as a booking-flow failure to the caller — the real booking already succeeded.
  return NextResponse.json(await mirrorBookingToGoogleCalendar(serviceRole, bookingId));
}
