import { NextResponse } from "next/server";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";
import { normalizeEmail } from "@/lib/public-booking";
import { canSignProofs, checkFormToken, emailCodeNow } from "@/lib/public-booking-proof";
import { rateLimitAllows } from "@/lib/rate-limit";
import { isSendGridConfigured, sendEmail } from "@/lib/sendgrid";

// Emails a six-digit code to the address a visitor typed, so a booking is only ever tied to an inbox they can read. The message
// is fixed text: nothing the visitor typed (not even their name) goes into it, so this cannot be used to send someone else's words.
// Limited hard per address, per visitor and per page, because anyone can ask for a code to any address.
export async function POST(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  const slug = cleanParam(rawSlug, 40);
  if (!slug || !canSignProofs() || !isSendGridConfigured()) return NextResponse.json({ error: "Online booking isn't available right now." }, { status: 503 });

  const limited = await limitByIp(request, "pb-code-ip", 10, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!checkFormToken(body?.formToken, slug, Date.now()).ok) return NextResponse.json({ error: "Please reload the page and try again." }, { status: 400 });

  if (!(await rateLimitAllows(`pb-code-email:${email}`, 3, 3600))) {
    return NextResponse.json({ error: "A code was already sent to that address. Check your inbox and spam, or try again in an hour." }, { status: 429 });
  }
  if (!(await rateLimitAllows(`pb-code-page:${slug}`, 100, 3600))) {
    return NextResponse.json({ error: "This page is busy right now. Please try again in a little while." }, { status: 429 });
  }

  const store = publicStore();
  const page = await store.pageBySlug(slug);
  if (!page || !page.enabled) return NextResponse.json({ error: "This booking page isn't available." }, { status: 404 });

  const code = emailCodeNow(slug, email, Date.now());
  const sent = await sendEmail(
    email,
    `Your confirmation code: ${code}`,
    `Your code to confirm this email address for booking a session is ${code}.\n\nIt works for about 15 minutes. If you didn't ask for it, ignore this message; nothing was booked.`
  );
  if (!sent) return NextResponse.json({ error: "We couldn't send the email. Please try again in a few minutes." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
