import { NextResponse } from "next/server";
import { cleanParam, limitByIp } from "@/lib/public-booking-route";
import { normalizeEmail } from "@/lib/public-booking";
import { canSignProofs, emailCodeIsValid, signEmailProof } from "@/lib/public-booking-proof";
import { rateLimitAllows } from "@/lib/rate-limit";

// Checks the code the visitor typed. A right code returns a proof, good for 30 minutes, that the booking must carry.
// Wrong guesses are limited per address so a six-digit code cannot be brute forced.
export async function POST(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  const slug = cleanParam(rawSlug, 40);
  if (!slug || !canSignProofs()) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const limited = await limitByIp(request, "pb-confirm-ip", 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (!email || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  if (!(await rateLimitAllows(`pb-confirm-email:${email}`, 6, 1800))) {
    return NextResponse.json({ error: "Too many tries. Ask for a new code in a little while." }, { status: 429 });
  }
  const now = Date.now();
  if (!emailCodeIsValid(slug, email, typeof body?.code === "string" ? body.code.trim() : "", now)) {
    return NextResponse.json({ error: "That code isn't right, or it has expired." }, { status: 400 });
  }
  return NextResponse.json({ emailProof: signEmailProof(slug, email, now) });
}
