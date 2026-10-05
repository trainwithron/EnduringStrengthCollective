import { NextResponse } from "next/server";
import { cancelManagedBooking, getManagedBooking, rescheduleManagedBooking } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";

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

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = cleanParam(raw, 100);
  if (!token) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const limited = await limitByIp(request, "pb-manage-act", 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const store = publicStore();
  if (body?.action === "cancel") {
    const r = await cancelManagedBooking(store, token);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  if (body?.action === "reschedule" && typeof body.startIso === "string") {
    const r = await rescheduleManagedBooking(store, token, body.startIso);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
