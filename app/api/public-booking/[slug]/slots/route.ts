import { NextResponse } from "next/server";
import { getOpenSlots } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";

// The open times for one public session type, worked out from the coach's real calendar on the server.
export async function GET(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  const slug = cleanParam(rawSlug, 40);
  const type = cleanParam(new URL(request.url).searchParams.get("type") ?? undefined, 64);
  if (!slug || !type) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await limitByIp(request, "pb-slots", 240, 3600);
  if (limited) return limited;

  const result = await getOpenSlots(publicStore(), slug, type);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ timezone: result.timezone, slots: result.slots });
}
