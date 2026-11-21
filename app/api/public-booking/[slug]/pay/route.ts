import { NextResponse } from "next/server";
import { checkPublicBooking } from "@/lib/public-booking-engine";
import { cleanParam, limitByIp, publicStore } from "@/lib/public-booking-route";
import { normalizeEmail, paysWhenBooking } from "@/lib/public-booking";
import { canSignProofs, checkEmailProof, checkFormToken } from "@/lib/public-booking-proof";
import { rateLimitAllows } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isEmailConfigured } from "@/lib/email";
import { appOrigin } from "@/lib/app-url";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { feePercentForOrg, getOrgConnect } from "@/lib/connect-payee";
import { platformFeeCents } from "@/lib/platform-fee";
import { generateClaimToken, hashClaimToken } from "@/lib/client-claim-token";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { CHECKOUT_MINUTES, HOLD_MINUTES, PURCHASE_KIND } from "@/lib/paid-booking";

// "Pay and book" on a coach's public page (wave 3 C7). Every check the free booking makes (form token, confirmed email, limits, the coach's real open times), then:
// the time is HELD (nothing is booked), and the visitor goes to Stripe to pay by card on the organization's own account, Spotlight's usual fee. The booking is made only by
// the paid checkout (app/api/stripe/webhook, lib/paid-booking.ts). Leaving checkout, or never paying, leaves no booking: the hold runs out.
export async function POST(request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await props.params;
  const slug = cleanParam(rawSlug, 40);
  if (!slug) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!canSignProofs() || !isEmailConfigured()) return NextResponse.json({ error: "Online booking isn't available right now." }, { status: 503 });
  if (!isStripeConfigured()) return NextResponse.json({ error: "Paying online isn't available right now. Please contact your coach." }, { status: 503 });

  const limited = await limitByIp(request, "pb-pay-ip", 8, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const sessionTypeId = typeof body?.sessionTypeId === "string" ? body.sessionTypeId : "";
  const startIso = typeof body?.startIso === "string" ? body.startIso : "";
  if (!sessionTypeId || !startIso) return NextResponse.json({ error: "Pick a session and a time." }, { status: 400 });
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const nowMs = Date.now();
  const form = checkFormToken(body?.formToken, slug, nowMs);
  if (!form.ok) return NextResponse.json({ error: "That didn't go through. Please reload the page and try again." }, { status: 400 });
  if (!email || !checkEmailProof(body?.emailProof, slug, email, nowMs)) return NextResponse.json({ error: "Please confirm your email address first." }, { status: 400 });
  if (!(await rateLimitAllows(`pb-pay-email:${slug}:${email}`, 6, 86400))) return NextResponse.json({ error: "Too many tries. Please try again tomorrow." }, { status: 429 });
  if (!(await rateLimitAllows(`pb-book-page:${slug}`, 60, 3600))) return NextResponse.json({ error: "This page is busy right now. Please try again in a little while." }, { status: 429 });

  const store = publicStore();
  const checked = await checkPublicBooking(store, { slug, sessionTypeId, startIso, name: body.name, email: body.email, phone: body.phone, note: body.note, honeypot: body.website, renderedAtMs: form.issuedMs });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
  const { page, type, guest, start, end, timezone } = checked;
  if (!paysWhenBooking(type) || !type.organizationId) return NextResponse.json({ error: "This session isn't paid online. Please reload the page." }, { status: 400 });
  const amountCents = type.displayPriceCents as number;

  const db = createServiceRoleClient();
  const connect = await getOrgConnect(db, type.organizationId);
  if (connect.status !== "ready" || !connect.accountId) return NextResponse.json({ error: `${page.coachName} can't take payments online right now. Please contact them to book.` }, { status: 409 });
  const accountId = connect.accountId;
  let feePercent: number;
  try {
    feePercent = await feePercentForOrg(db, type.organizationId);
  } catch {
    return NextResponse.json({ error: "We couldn't start your payment. Please try again in a moment." }, { status: 503 });
  }
  const stripe = getStripeClient();

  // Starting again (say after leaving checkout) replaces this visitor's earlier hold: its checkout is closed first so it can never be paid as well.
  const { data: earlier } = await db.from("public_booking_holds").select("id, checkout_session_id, stripe_account_id").eq("coach_id", page.coachId).eq("guest_email", guest.email).eq("state", "open");
  for (const h of (earlier ?? []) as { id: string; checkout_session_id: string | null; stripe_account_id: string }[]) {
    if (h.checkout_session_id) {
      try {
        await stripe.checkout.sessions.expire(h.checkout_session_id, {}, { stripeAccount: h.stripe_account_id });
      } catch {
        // already paid or already closed: read it back to be sure
        const s = await stripe.checkout.sessions.retrieve(h.checkout_session_id, {}, { stripeAccount: h.stripe_account_id }).catch(() => null);
        if (!s || s.status !== "expired") return NextResponse.json({ error: "Your earlier payment is still being finished. Check your email, or try again in a few minutes." }, { status: 409 });
      }
    }
    await db.from("public_booking_holds").update({ state: "lapsed", guest_name: null, guest_email: null, guest_phone: null, note: null }).eq("id", h.id).eq("state", "open");
  }

  const statusToken = generateClaimToken();
  const { data: hold, error: holdError } = await db
    .from("public_booking_holds")
    .insert({
      coach_id: page.coachId,
      session_type_id: type.id,
      organization_id: type.organizationId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      expires_at: new Date(nowMs + HOLD_MINUTES * 60000).toISOString(),
      status_token_hash: hashClaimToken(statusToken),
      guest_name: guest.name,
      guest_email: guest.email,
      guest_phone: guest.phone,
      note: guest.note,
      amount_cents: amountCents,
      stripe_account_id: accountId,
    })
    .select("id")
    .single();
  if (holdError || !hold) {
    const busyNow = holdError?.code === "23505";
    return NextResponse.json({ error: busyNow ? "You already have a payment open for this coach. Finish it, or try again in a few minutes." : "We couldn't start your payment. Please try again in a moment." }, { status: busyNow ? 409 : 502 });
  }

  // The time is held now; check once more that nobody took it in between (two visitors paying for the same time).
  const busy = await store.busy(page.coachId, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000), hold.id);
  if (busy.some((b) => b.start < end && b.end > start)) {
    await db.from("public_booking_holds").delete().eq("id", hold.id);
    return NextResponse.json({ error: "That time was just taken. Please pick another." }, { status: 409 });
  }

  const origin = appOrigin(request);
  const when = formatInTimezone(start, timezone, "dateTime");
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: guest.email,
        expires_at: Math.floor(nowMs / 1000) + CHECKOUT_MINUTES * 60,
        payment_intent_data: { application_fee_amount: platformFeeCents(amountCents, feePercent), metadata: { purchase_kind: PURCHASE_KIND, hold_id: hold.id } },
        line_items: [{ price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: `${type.name} with ${page.coachName}`, description: when } }, quantity: 1 }],
        success_url: `${origin}/book/${slug}/paid?s=${statusToken}`,
        cancel_url: `${origin}/book/${slug}?payment=cancelled`,
        metadata: { purchase_kind: PURCHASE_KIND, hold_id: hold.id },
      },
      { stripeAccount: accountId, idempotencyKey: `public-booking-checkout-${hold.id}` }
    );
    if (!session.url) throw new Error("no checkout address");
    await db.from("public_booking_holds").update({ checkout_session_id: session.id }).eq("id", hold.id);
    return NextResponse.json({ url: session.url });
  } catch {
    // no checkout, so no money: the hold goes at once
    await db.from("public_booking_holds").delete().eq("id", hold.id).eq("state", "open");
    return NextResponse.json({ error: "We couldn't start your payment. Please try again in a moment." }, { status: 502 });
  }
}
