import { NextResponse } from "next/server";
import { getPublicPage } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";
import { canSignProofs } from "@/lib/public-booking-proof";
import { isSendGridConfigured } from "@/lib/sendgrid";

// The coach's public page: their name, headline, intro and the session types they offer. Nothing about anyone else.
export async function GET(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await props.params;
  const slug = cleanParam(raw, 40);
  if (!slug) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await limitByIp(request, "pb-page", 240, 3600);
  if (limited) return limited;

  // Booking needs an email sender to confirm addresses. Until one is set up the page stays closed.
  if (!canSignProofs() || !isSendGridConfigured()) return NextResponse.json({ error: "This booking page isn't available." }, { status: 404 });

  const view = await getPublicPage(publicStore(), slug);
  if (!view) return NextResponse.json({ error: "This booking page isn't available." }, { status: 404 });
  return NextResponse.json(view);
}
