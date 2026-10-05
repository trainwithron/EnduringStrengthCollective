import { NextResponse } from "next/server";
import { managedBookingSlots } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";

// The times a visitor can move their booking to.
export async function GET(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token: raw } = await props.params;
  const token = cleanParam(raw, 100);
  if (!token) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const limited = await limitByIp(request, "pb-manage-slots", 120, 3600);
  if (limited) return limited;

  const r = await managedBookingSlots(publicStore(), token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ timezone: r.timezone, slots: r.slots });
}
