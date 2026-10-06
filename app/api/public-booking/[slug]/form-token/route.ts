import { NextResponse } from "next/server";
import { cleanParam, limitByIp } from "@/lib/public-booking-route";
import { canSignProofs, signFormToken } from "@/lib/public-booking-proof";

// Handed out when the booking form is shown. A booking without one, or sent too soon after it was issued, is refused.
export async function GET(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await props.params;
  const slug = cleanParam(raw, 40);
  if (!slug || !canSignProofs()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await limitByIp(request, "pb-form-token", 120, 3600);
  if (limited) return limited;
  return NextResponse.json({ formToken: signFormToken(slug, Date.now()) }, { headers: { "cache-control": "no-store" } });
}
