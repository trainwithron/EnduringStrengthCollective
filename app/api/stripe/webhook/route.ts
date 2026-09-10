import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { computeRevenueSplit, type CoachShare } from "@/lib/revenue-splits";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

// Splits a payment's proceeds across the org's coaches per the existing
// platform_fee_pct/revenue_share_pct model (lib/revenue-splits.ts —
// unchanged math, just wired to real transfers here) and moves each
// coach's cut to their connected Stripe account. A coach who hasn't
// finished Connect onboarding yet (no enabled connected account) is
// silently skipped rather than blocking the whole payment — their share
// simply isn't transferred until they connect, same as how a package
// with is_active=false just doesn't appear rather than erroring.
async function createRevenueSplitTransfers(
  supabase: SupabaseClient,
  stripe: Stripe,
  eventId: string,
  groupId: string,
  amountCents: number
) {
  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  if (!group?.organization_id) return;

  const { data: org } = await supabase
    .from("organizations")
    .select("platform_fee_pct")
    .eq("id", group.organization_id)
    .maybeSingle();
  if (!org) return;

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
  const split = computeRevenueSplit(amountCents, org.platform_fee_pct, coaches);
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

          await createRevenueSplitTransfers(supabase, stripe, event.id, groupId, session.amount_total ?? 0);
        } else if (session.mode === "subscription" && typeof session.subscription === "string") {
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

        await createRevenueSplitTransfers(supabase, stripe, event.id, groupId, invoice.amount_paid ?? 0);
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
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const athleteId = subscription.metadata?.athlete_id;
        const groupId = subscription.metadata?.group_id;
        if (!athleteId || !groupId) break;

        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : (subscription.status as "active" | "past_due" | "canceled" | "incomplete");

        // current_period_end moved off the subscription object onto each
        // subscription item in newer Stripe API versions — this app only
        // ever creates a single-item subscription (one Price per
        // membership), so the first item's period end is the right one.
        const periodEndUnix = subscription.items.data[0]?.current_period_end;

        await supabase.from("membership_subscriptions").upsert(
          {
            athlete_id: athleteId,
            group_id: groupId,
            stripe_subscription_id: subscription.id,
            status,
            current_period_end: periodEndUnix
              ? new Date(periodEndUnix * 1000).toISOString()
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
