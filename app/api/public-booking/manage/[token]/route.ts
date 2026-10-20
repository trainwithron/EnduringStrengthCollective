import { NextResponse } from "next/server";
import { cancelManagedBooking, getManagedBooking, rescheduleManagedBooking } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";
import { hashClaimToken } from "@/lib/client-claim-token";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCoachPush } from "@/lib/coach-notice";
import { formatInTimezone, timezoneForProfiles } from "@/lib/format-in-timezone";
import { visitorChangeNotice } from "@/lib/visitor-change-notice";

// A visitor's private link: see the booking, move it, or cancel it. The token is the only credential, so it is long and
// random, only its hash is stored, and every address is limited in how many guesses it gets.
export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = cleanParam(raw, 100);
  if (!token) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const limited = await limitByIp(request, "pb-manage", 120, 3600);
  if (limited) return limited;

  const view = await getManagedBooking(publicStore(), token);
  if (!view.ok) return NextResponse.json({ error: view.error }, { status: view.status });
  return NextResponse.json(view);
}

// The coach is told when a visitor cancels or moves their booking (a push, best effort: the change has already happened). The booking itself was announced when it was made; its change never was (Oct 19 audit).
async function tellCoach(link: { coachId: string; groupId: string; guestName: string; startAt: string; sessionTypeName: string | null }, change: { kind: "cancelled" } | { kind: "moved"; newStartIso: string }) {
  try {
    const db = createServiceRoleClient();
    const tz = await timezoneForProfiles(db, [link.coachId]);
    const notice = visitorChangeNotice({
      guestName: link.guestName,
      typeName: link.sessionTypeName,
      oldWhen: formatInTimezone(link.startAt, tz, "dateTime"),
      ...(change.kind === "moved" ? { kind: "moved" as const, newWhen: formatInTimezone(change.newStartIso, tz, "dateTime") } : { kind: "cancelled" as const }),
    });
    await sendCoachPush(db, link.coachId, "bookings", notice.title, notice.body, `/groups/${link.groupId}/calendar`);
  } catch {
    // Quiet.
  }
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = cleanParam(raw, 100);
  if (!token) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const limited = await limitByIp(request, "pb-manage-act", 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const store = publicStore();
  if (body?.action === "cancel") {
    const link = await store.linkByHash(hashClaimToken(token));
    const r = await cancelManagedBooking(store, token);
    if (r.ok && link) await tellCoach(link, { kind: "cancelled" });
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  if (body?.action === "reschedule" && typeof body.startIso === "string") {
    const link = await store.linkByHash(hashClaimToken(token));
    const r = await rescheduleManagedBooking(store, token, body.startIso);
    if (r.ok && link) await tellCoach(link, { kind: "moved", newStartIso: r.startIso ?? body.startIso });
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
