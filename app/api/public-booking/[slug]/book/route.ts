import { NextResponse } from "next/server";
import { createPublicBooking } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";
import { normalizeEmail } from "@/lib/public-booking";
import { rateLimitAllows } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { isSendGridConfigured, sendEmail } from "@/lib/sendgrid";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { appOrigin } from "@/lib/app-url";

// A visitor books a time with a coach, no account needed. Limited per address, per coach and per email so it cannot be used to
// fill someone's calendar; a hidden field and a minimum fill-in time catch simple bots. The engine does the real checking.
export async function POST(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  const slug = cleanParam(rawSlug, 40);
  if (!slug) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const limited = await limitByIp(request, "pb-book-ip", 8, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const sessionTypeId = typeof body?.sessionTypeId === "string" ? body.sessionTypeId : "";
  const startIso = typeof body?.startIso === "string" ? body.startIso : "";
  if (!sessionTypeId || !startIso) return NextResponse.json({ error: "Pick a session and a time." }, { status: 400 });

  // Per email and per coach, before any work is done.
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (email && !(await rateLimitAllows(`pb-book-email:${slug}:${email}`, 3, 86400))) {
    return NextResponse.json({ error: "Too many requests. Please try again tomorrow." }, { status: 429 });
  }
  if (!(await rateLimitAllows(`pb-book-page:${slug}`, 60, 3600))) {
    return NextResponse.json({ error: "This page is busy right now. Please try again in a little while." }, { status: 429 });
  }

  const result = await createPublicBooking(publicStore(), {
    slug,
    sessionTypeId,
    startIso,
    name: body.name,
    email: body.email,
    phone: body.phone,
    note: body.note,
    honeypot: body.website,
    renderedAtMs: typeof body.renderedAtMs === "number" ? body.renderedAtMs : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const origin = appOrigin(request);
  const manageUrl = `${origin}/book/manage/${result.manageToken}`;
  const when = formatInTimezone(new Date(result.startIso), result.timezone, "dateTime");

  // Tell the coach (a push) and, when an email sender is set up, the visitor. Both best effort: the booking already happened.
  const db = createServiceRoleClient();
  try {
    await sendPushToProfile(db, result.coachId, "New booking", `${result.guestName} booked ${result.typeName} for ${when}.`, `/groups/${result.groupId}/calendar`);
  } catch {
    // Quiet.
  }
  let emailSent = false;
  if (isSendGridConfigured()) {
    emailSent = await sendEmail(
      result.guestEmail,
      `Your session with ${result.coachName} is booked`,
      `Hi ${result.guestName},\n\nYour ${result.typeName} with ${result.coachName} is booked for ${when}.\n\nNeed to change it or cancel? Use this private link:\n${manageUrl}\n\nSee you then.`
    );
    if (emailSent) {
      await db.from("booking_manage_links").update({ email_sent_at: new Date().toISOString() }).eq("booking_id", result.bookingId);
    }
  }

  return NextResponse.json({
    ok: true,
    coachName: result.coachName,
    typeName: result.typeName,
    startIso: result.startIso,
    endIso: result.endIso,
    timezone: result.timezone,
    manageUrl,
    emailSent,
  });
}
