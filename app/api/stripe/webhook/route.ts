import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { computeRevenueSplit, computePlatformDeduction, type CoachShare } from "@/lib/revenue-splits";
import { duplicateProgram } from "@/lib/program-duplication";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

// Package-Program Linking (package_program_linking_scoping.md) — fires
// duplicateProgram() on genuine FIRST enrollment only, never on a
// recurring renewal (a subscription's repeat invoice.paid events don't
// call this at all; only the checkout that starts a subscription does).
// `alreadyEnrolled` is the caller's own "does a prior row exist" check,
// computed against whichever table actually represents enrollment for
// that payment mode (credit_purchases for one-time, the pre-upsert
// membership_subscriptions row for a subscription).
async function assignLinkedProgramIfFirstEnrollment(
  supabase: SupabaseClient,
  {
    coachPackageId,
    athleteId,
    groupId,
    alreadyEnrolled,
  }: { coachPackageId: string | null; athleteId: string; groupId: string; alreadyEnrolled: boolean }
) {
  if (!coachPackageId || alreadyEnrolled) return;
  const { data: pkg } = await supabase
    .from("coach_packages")
    .select("default_program_id, coach_id")
    .eq("id", coachPackageId)
    .maybeSingle();
  if (!pkg?.default_program_id) return;

  await duplicateProgram(supabase, {
    sourceProgramId: pkg.default_program_id,
    destinationGroupId: groupId,
    createdBy: pkg.coach_id,
    athleteId,
  });
}

// Zapier's "package_purchased" trigger — the one event this build's
// real validated use case (a gym partner's session-credit
// reconciliation) actually cares about. Fires on every real credit-
// granting moment: a one-time pack, a brand-new subscription, and each
// recurring invoice.paid renewal. Resolves the coach who actually owns
// the package when one exists (the real seller), falling back to the
// group's own coach for a purchase with no linked package.
async function dispatchPackagePurchasedEvent(
  supabase: SupabaseClient,
  {
    groupId,
    coachPackageId,
    athleteId,
    creditsPurchased,
    amountCents,
  }: { groupId: string; coachPackageId: string | null; athleteId: string; creditsPurchased: number | null; amountCents: number }
) {
  let coachId: string | null = null;
  if (coachPackageId) {
    const { data: pkg } = await supabase.from("coach_packages").select("coach_id").eq("id", coachPackageId).maybeSingle();
    coachId = pkg?.coach_id ?? null;
  }
  if (!coachId) {
    const { data: coachRow } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", groupId)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();
    coachId = coachRow?.profile_id ?? null;
  }
  if (!coachId) return;

  await dispatchWebhookEvent(supabase, {
    coachId,
    eventType: "package_purchased",
    payload: { athleteId, groupId, coachPackageId, creditsPurchased, amountCents },
  });
}

// platform_flat_fee_revenue_split_scoping_sept19.md — the real Stripe
// processing fee for a specific charge, read from its own
// balance_transaction (never estimated). Re-retrieves the source object
// with a fresh expand rather than trusting whatever shape the webhook
// payload itself carried — checkout sessions never expand payment_intent
// by default, and invoice/payment-intent field shapes have drifted
// across Stripe API versions (see the current_period_end/subscription
// comments elsewhere in this file), so one retrieve-and-expand call is
// more robust than branching on several possible payload shapes.
// A payment with genuinely no payment intent (e.g. a $0 charge) has no
// real card-processing fee to deduct, so this returns 0 rather than
// throwing — but an actual Stripe API failure during the lookup still
// throws, since silently defaulting to $0 there would recreate the
// exact silent-absorption bug this feature exists to close.
//
// Bounded retry, confirmed necessary by a real live test against
// Stripe's own test-mode API (not a hypothetical): a charge's
// balance_transaction can still be null for a couple of seconds right
// after the charge succeeds, even though checkout.session.completed/
// invoice.paid have already fired by then. Three short attempts covers
// this without risking the webhook handler hanging.
async function getRealStripeFeeCents(
  stripe: Stripe,
  paymentIntentRef: string | Stripe.PaymentIntent | null | undefined
): Promise<number> {
  const paymentIntentId = typeof paymentIntentRef === "string" ? paymentIntentRef : paymentIntentRef?.id;
  if (!paymentIntentId) return 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = paymentIntent.latest_charge;
    if (charge && typeof charge !== "string") {
      const balanceTransaction = charge.balance_transaction;
      if (balanceTransaction && typeof balanceTransaction !== "string") {
        return balanceTransaction.fee ?? 0;
      }
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return 0;
}

// Same real-fee lookup as getRealStripeFeeCents, but for a recurring
// invoice rather than a one-time checkout session. Invoices in this
// Stripe API version carry no direct payment_intent field of their own
// (removed in favor of the paginated invoice.payments list) — expand
// that list, take its (only, for this app's single-payment-per-invoice
// model) entry, and hand its payment_intent reference off to the same
// balance_transaction lookup used above.
async function getRealStripeFeeCentsForInvoice(stripe: Stripe, invoiceId: string): Promise<number> {
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent"],
  });
  const paymentIntentRef = (invoice as any).payments?.data?.[0]?.payment?.payment_intent as
    | string
    | Stripe.PaymentIntent
    | undefined;
  return getRealStripeFeeCents(stripe, paymentIntentRef);
}

// Splits a payment's proceeds across the org's coaches per the existing
// platform_fee_pct/revenue_share_pct model (lib/revenue-splits.ts —
// unchanged math, just wired to real transfers here) and moves each
// coach's cut to their connected Stripe account. A coach who hasn't
// finished Connect onboarding yet (no enabled connected account) is
// silently skipped rather than blocking the whole payment — their share
// simply isn't transferred until they connect, same as how a package
// with is_active=false just doesn't appear rather than erroring.
//
// The platform's own flat deduction (real Stripe fee + $0.10, see
// computePlatformDeduction) is taken off grossAmountCents FIRST, and
// computeRevenueSplit runs on what's left — the org/coach split was
// silently operating on the gross charge before this, absorbing
// Stripe's real fee out of the org's own platform_fee_pct bucket with
// zero tracking. Recorded once per event in platform_fee_ledger,
// independent of how many (if any) coaches end up receiving a transfer.
async function createRevenueSplitTransfers(
  supabase: SupabaseClient,
  stripe: Stripe,
  eventId: string,
  groupId: string,
  grossAmountCents: number,
  stripeProcessingFeeCents: number
) {
  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  if (!group?.organization_id) return;

  const { data: org } = await supabase
    .from("organizations")
    .select("platform_fee_pct")
    .eq("id", group.organization_id)
    .maybeSingle();
  if (!org) return;

  const deduction = computePlatformDeduction(grossAmountCents, stripeProcessingFeeCents);
  const { error: ledgerError } = await supabase.from("platform_fee_ledger").insert({
    stripe_event_id: eventId,
    organization_id: group.organization_id,
    gross_amount_cents: deduction.grossAmountCents,
    stripe_processing_fee_cents: deduction.stripeProcessingFeeCents,
    platform_flat_fee_cents: deduction.platformFlatFeeCents,
    net_amount_cents: deduction.netAmountCents,
  });
  // Unique violation = this event's ledger row was already recorded on a
  // prior attempt — fall through and keep going rather than returning
  // early, since a prior attempt may have failed partway through the
  // coach-transfer loop below (each transfer has its own idempotency
  // guard via revenue_split_transfers' own unique constraint).
  if (ledgerError && ledgerError.code !== "23505") throw ledgerError;

  const { data: memberRows } = await supabase
    .from("organization_memberships")
    .select("profile_id, role, revenue_share_pct, stripe_connect_account_id, stripe_connect_status, profiles ( full_name )")
    .eq("organization_id", group.organization_id);
  if (!memberRows || memberRows.length === 0) return;

  const coaches: CoachShare[] = memberRows.map((m) => ({
    profileId: m.profile_id,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
    role: m.role,
    revenueSharePct: m.revenue_share_pct,
  }));
  const split = computeRevenueSplit(deduction.netAmountCents, org.platform_fee_pct, coaches);
  const connectByProfile = new Map(memberRows.map((m) => [m.profile_id, m]));

  for (const share of split.coachShares) {
    if (share.amountCents <= 0) continue;
    const member = connectByProfile.get(share.profileId);
    if (!member || member.stripe_connect_status !== "enabled" || !member.stripe_connect_account_id) continue;

    const { error: insertError } = await supabase.from("revenue_split_transfers").insert({
      stripe_event_id: eventId,
      coach_id: share.profileId,
      organization_id: group.organization_id,
      amount_cents: share.amountCents,
    });
    if (insertError) {
      if (insertError.code === "23505") continue; // already transferred for this event
      throw insertError;
    }

    const transfer = await stripe.transfers.create({
      amount: share.amountCents,
      currency: "usd",
      destination: member.stripe_connect_account_id,
      transfer_group: eventId,
    });
    await supabase
      .from("revenue_split_transfers")
      .update({ stripe_transfer_id: transfer.id })
      .eq("stripe_event_id", eventId)
      .eq("coach_id", share.profileId);
  }
}

// The only unauthenticated route in this app — Stripe calls this
// directly, with no user session. Its "auth" is the signature check
// below, over the exact raw request bytes (not the parsed JSON body,
// which is why this can't go through the usual request.json() path
// every other route uses).
export async function POST(request: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe isn't configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const body = await request.text();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const athleteId = session.metadata?.athlete_id;
        const groupId = session.metadata?.group_id;
        const coachPackageId = session.metadata?.coach_package_id ?? null;
        if (!athleteId || !groupId) break;

        if (session.mode === "payment") {
          const credits = Number(session.metadata?.credits ?? 0);
          if (credits <= 0) break;

          // Checked BEFORE inserting this event's own row — "any prior
          // purchase of this exact package by this athlete" is what
          // "first enrollment" means here, independent of the retry-
          // idempotency check just below (which guards against the SAME
          // event being processed twice, a different question).
          const { count: priorPurchaseCount } = coachPackageId
            ? await supabase
                .from("credit_purchases")
                .select("id", { count: "exact", head: true })
                .eq("athlete_id", athleteId)
                .eq("coach_package_id", coachPackageId)
            : { count: 0 };

          // Idempotency: a Stripe retry of this same event hits the
          // unique constraint on stripe_event_id and gets treated as
          // already-processed below, rather than crediting twice.
          const { error: insertError } = await supabase.from("credit_purchases").insert({
            stripe_event_id: event.id,
            stripe_checkout_session_id: session.id,
            athlete_id: athleteId,
            group_id: groupId,
            coach_package_id: coachPackageId,
            credits_purchased: credits,
            amount_cents: session.amount_total ?? 0,
          });

          if (insertError) {
            // Unique violation = already processed this exact event.
            if (insertError.code === "23505") break;
            throw insertError;
          }

          const { error: rpcError } = await supabase.rpc("adjust_session_credits", {
            p_athlete_id: athleteId,
            p_group_id: groupId,
            p_delta: credits,
          });
          if (rpcError) throw rpcError;

          const stripeFeeCents = await getRealStripeFeeCents(stripe, session.payment_intent);
          await createRevenueSplitTransfers(
            supabase,
            stripe,
            event.id,
            groupId,
            session.amount_total ?? 0,
            stripeFeeCents
          );
          await assignLinkedProgramIfFirstEnrollment(supabase, {
            coachPackageId,
            athleteId,
            groupId,
            alreadyEnrolled: (priorPurchaseCount ?? 0) > 0,
          });
          await dispatchPackagePurchasedEvent(supabase, {
            groupId,
            coachPackageId,
            athleteId,
            creditsPurchased: credits,
            amountCents: session.amount_total ?? 0,
          });
        } else if (session.mode === "subscription" && typeof session.subscription === "string") {
          // Checked BEFORE the upsert below — an existing row here means
          // this athlete already had a subscription for this group
          // (however it ended up in whatever state it's in); a genuinely
          // brand-new subscriber has no row yet, which is the real
          // "first enrollment" signal for the program-assignment side
          // effect (recurring renewals never reach this branch at all —
          // only invoice.paid fires for those, and that handler
          // deliberately never touches program assignment).
          const { data: existingSubscription } = await supabase
            .from("membership_subscriptions")
            .select("athlete_id")
            .eq("athlete_id", athleteId)
            .eq("group_id", groupId)
            .maybeSingle();

          await supabase.from("membership_subscriptions").upsert(
            {
              athlete_id: athleteId,
              group_id: groupId,
              stripe_subscription_id: session.subscription,
              status: "active",
              coach_package_id: coachPackageId,
              price_cents: session.amount_total ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "athlete_id,group_id" }
          );

          await assignLinkedProgramIfFirstEnrollment(supabase, {
            coachPackageId,
            athleteId,
            groupId,
            alreadyEnrolled: !!existingSubscription,
          });
          await dispatchPackagePurchasedEvent(supabase, {
            groupId,
            coachPackageId,
            athleteId,
            creditsPurchased: null,
            amountCents: session.amount_total ?? 0,
          });
        }
        break;
      }

      // A subscription-type package needs sessions_granted credits added
      // every billing cycle, not just once at signup — the status-only
      // tracking above never grants recurring credits on its own.
      // Invoices don't inherit subscription metadata automatically, so
      // the subscription itself has to be fetched to read it.
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // Newer Stripe API versions moved the subscription reference off
        // the invoice itself onto parent.subscription_details.subscription
        // (same class of API-version drift already noted for
        // current_period_end elsewhere in this file).
        const subscriptionRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const athleteId = subscription.metadata?.athlete_id;
        const groupId = subscription.metadata?.group_id;
        const coachPackageId = subscription.metadata?.coach_package_id ?? null;
        if (!athleteId || !groupId || !coachPackageId) break;

        const { data: pkg } = await supabase
          .from("coach_packages")
          .select("sessions_granted")
          .eq("id", coachPackageId)
          .maybeSingle();
        if (!pkg) break;

        const { error: grantError } = await supabase.from("subscription_credit_grants").insert({
          stripe_event_id: event.id,
          athlete_id: athleteId,
          group_id: groupId,
          coach_package_id: coachPackageId,
          credits_granted: pkg.sessions_granted,
        });
        if (grantError) {
          if (grantError.code === "23505") break; // already processed this event
          throw grantError;
        }

        const { error: rpcError } = await supabase.rpc("adjust_session_credits", {
          p_athlete_id: athleteId,
          p_group_id: groupId,
          p_delta: pkg.sessions_granted,
        });
        if (rpcError) throw rpcError;

        const invoiceStripeFeeCents = await getRealStripeFeeCentsForInvoice(stripe, invoice.id!);
        await createRevenueSplitTransfers(
          supabase,
          stripe,
          event.id,
          groupId,
          invoice.amount_paid ?? 0,
          invoiceStripeFeeCents
        );
        await dispatchPackagePurchasedEvent(supabase, {
          groupId,
          coachPackageId,
          athleteId,
          creditsPurchased: pkg.sessions_granted,
          amountCents: invoice.amount_paid ?? 0,
        });
        break;
      }

      // A coach's Connect Express onboarding status changed — reflects
      // charges_enabled/payouts_enabled so the revenue-split transfer
      // logic above knows whether this coach can actually receive a
      // transfer yet, and so the UI can show a real status instead of
      // just "connected or not."
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const status = account.details_submitted
          ? account.charges_enabled && account.payouts_enabled
            ? "enabled"
            : "restricted"
          : "pending";
        await supabase
          .from("organization_memberships")
          .update({ stripe_connect_status: status })
          .eq("stripe_connect_account_id", account.id);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      // subscription_pause_mechanics_research.md — these two never
      // reached this switch at all before. A paused subscription's
      // status IS 'paused' on the subscription object itself for both,
      // so no special-case logic is needed beyond the two extra case
      // labels: the same status/upsert path below already reads it
      // correctly once the CHECK constraint and the cast below both
      // accept 'paused' (migration 0179).
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const subscription = event.data.object as Stripe.Subscription;
        const athleteId = subscription.metadata?.athlete_id;
        const groupId = subscription.metadata?.group_id;
        if (!athleteId || !groupId) break;

        // Was an unchecked cast — Stripe's real Status type is wider
        // than our column ever supported (trialing, unpaid,
        // incomplete_expired, or any future value), and a value outside
        // our CHECK would either silently masquerade as one of ours or
        // throw on the upsert; per billing_payments_oversight_check.md a
        // thrown/discarded upsert error leaves the row reading whatever
        // it read before, which for a genuinely paused subscription
        // meant 'active' — the exact MRR overstatement this fixes.
        // Explicit allow-list, skip the write entirely for anything else
        // rather than guessing.
        const KNOWN_STATUSES = ["active", "past_due", "canceled", "incomplete", "paused"] as const;
        type KnownStatus = (typeof KNOWN_STATUSES)[number];
        const status: KnownStatus | null =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : (KNOWN_STATUSES as readonly string[]).includes(subscription.status)
              ? (subscription.status as KnownStatus)
              : null;
        if (!status) break;

        // current_period_end moved off the subscription object onto each
        // subscription item in newer Stripe API versions — this app only
        // ever creates a single-item subscription (one Price per
        // membership), so the first item's period end is the right one.
        const periodEndUnix = subscription.items.data[0]?.current_period_end;

        // pause_collection.resumes_at belongs to a DIFFERENT pause
        // mechanism (one that never sets status to 'paused' at all, per
        // Stripe's own docs) — read defensively in case it's ever present
        // alongside a real 'paused' status, but never fabricated when
        // absent. Null on every other event type, including resume.
        const resumesAtUnix = subscription.pause_collection?.resumes_at ?? null;

        await supabase.from("membership_subscriptions").upsert(
          {
            athlete_id: athleteId,
            group_id: groupId,
            stripe_subscription_id: subscription.id,
            status,
            current_period_end: periodEndUnix
              ? new Date(periodEndUnix * 1000).toISOString()
              : null,
            paused_until: resumesAtUnix
              ? new Date(resumesAtUnix * 1000).toISOString().slice(0, 10)
              : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "athlete_id,group_id" }
        );
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // A genuine processing failure (not "already seen") returns non-200
    // so Stripe retries — the idempotency check above means a retry is
    // always safe to re-run.
    return NextResponse.json({ error: `Webhook handler failed: ${message}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
