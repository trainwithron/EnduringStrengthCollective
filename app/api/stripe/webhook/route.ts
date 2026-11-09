import { notifyPaymentReceived } from "@/lib/notify-payment";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getConnectedStripeClient, getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { connectStatusFromAccount, constructEventFromSecrets, eventAccountMatchesGroup, feePercentForOrg, getPayeeForGroup, isPlatformOnlyPurchase } from "@/lib/connect-payee";
import { platformFeeCents } from "@/lib/platform-fee";
import { duplicateProgram } from "@/lib/program-duplication";
import { athleteHasCopyOfProgram, programBelongsToCoach } from "@/lib/package-program-access";
import { endsGroupAccess, storedSubscriptionStatus } from "@/lib/subscription-status";
import { grantLinkedGroupAccess, revokeLinkedGroupAccess } from "@/lib/package-group-access";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { LIFT_OFF_MONTHLY_CREDITS } from "@/lib/coach-credits";
import { recordAiTopUp } from "@/lib/ai-topup";
import { handlePaymentProblemEvent } from "@/lib/payment-events";
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
  // Checked again at copy time: the link may predate the ownership check, and this copy runs with the service role.
  if (!(await programBelongsToCoach(supabase, pkg.coach_id, pkg.default_program_id))) return;
  // A retried payment event (or an earlier enrollment) must never copy the program a second time.
  if (await athleteHasCopyOfProgram(supabase, { sourceProgramId: pkg.default_program_id, athleteId, groupId })) return;

  await duplicateProgram(supabase, {
    sourceProgramId: pkg.default_program_id,
    destinationGroupId: groupId,
    createdBy: pkg.coach_id,
    athleteId,
  });
}

// Access to the group a package includes. A buyer who could not be added (the group is full for a one-on-one space, a database hiccup) must not fail the payment, but it must leave a trace.
async function grantGroupAccessLogged(supabase: SupabaseClient, coachPackageId: string | null, athleteId: string) {
  const result = await grantLinkedGroupAccess(supabase, { coachPackageId, athleteId });
  if (result.error) console.error("package group access not granted", { coachPackageId, athleteId, error: result.error });
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
    eventKey,
  }: { groupId: string; coachPackageId: string | null; athleteId: string; creditsPurchased: number | null; amountCents: number; eventKey: string }
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
    // The same Stripe event is never announced twice, however many times it is delivered, and a delivery that never went out is sent on the retry.
    dedupeKey: eventKey,
  });
}

// The only unauthenticated route in this app — Stripe calls this
// directly, with no user session. Its "auth" is the signature check
// below, over the exact raw request bytes (not the parsed JSON body,
// which is why this can't go through the usual request.json() path
// every other route uses).
export async function POST(request: Request) {
  // Two endpoints can point here: the platform's own events and Connect events (from each coach's account). Each has its own signing secret.
  const webhookSecrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((v): v is string => !!v);
  if (!isStripeConfigured() || webhookSecrets.length === 0) {
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
    event = constructEventFromSecrets(stripe, body, signature, webhookSecrets);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  // Set on an event from a coach's connected account: anything looked up for it must be read on that account. Empty on the platform's own events (a coach paying Spotlight, and payments made before direct charges).
  const connectedAccount = event.account ?? null;
  const eventStripe = connectedAccount ? getConnectedStripeClient(connectedAccount) : stripe;

  try {
    switch (event.type) {
      // A delayed payment (a bank debit) completes the checkout unpaid and succeeds later: that later event is handled exactly like a paid completion.
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // credit_topup_low_tier_monetization_idea.md — a coach buying
        // their OWN credits/Lift Off, genuinely separate metadata shape
        // from the athlete_id/group_id client-billing path below. Lift
        // Off's actual credit grant happens in invoice.paid (every cycle,
        // including the first) — this branch only ever records the
        // subscription's existence/status, never grants credits itself,
        // matching the exact same split already used for the client-
        // billing membership_subscriptions flow below.
        const purchaseKind = session.metadata?.purchase_kind;

        // A coach paying Spotlight only ever happens on the platform's own account.
        if (connectedAccount && isPlatformOnlyPurchase(purchaseKind)) break;

        // A coach's paid AI top-up: adds to the organization's budget for the month. Only a settled payment counts, and the dollars come from the pack matching what was paid.
        if (purchaseKind === "ai_topup") {
          if (session.payment_status === "paid") {
            await recordAiTopUp(supabase, {
              eventId: event.id,
              sessionId: session.id,
              organizationId: session.metadata?.organization_id,
              subtotalCents: session.amount_subtotal,
              currency: session.currency,
              metadataPackCents: session.metadata?.pack_cents,
              eventCreatedSeconds: event.created,
            });
          }
          break;
        }

        if (purchaseKind === "coach_credit_pack" || purchaseKind === "coach_lift_off") {
          const coachId = session.metadata?.coach_id;
          if (!coachId) break;

          if (purchaseKind === "coach_credit_pack") {
            const credits = Number(session.metadata?.credits ?? 0);
            if (credits <= 0) break;

            // Recorded and added in ONE database step: if the credits can't be added the record is rolled back with them, so Stripe's retry grants again (before, the record survived a failed add and
            // the retry stopped there: the coach paid and got nothing). A repeat of an event that was fully handled changes nothing.
            const { error: packError } = await supabase.rpc("grant_coach_credit_pack_once", {
              p_event_id: event.id,
              p_session_id: session.id,
              p_coach_id: coachId,
              p_credits: credits,
              p_amount_cents: session.amount_total ?? 0,
            });
            if (packError) throw packError;
          } else if (typeof session.subscription === "string") {
            // A failed write is thrown so Stripe sends the event again: the coach has paid, so their plan must not stay unrecorded.
            const { error: liftOffStartError } = await supabase.from("lift_off_subscriptions").upsert(
              {
                coach_id: coachId,
                stripe_subscription_id: session.subscription,
                status: "active",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "coach_id" }
            );
            if (liftOffStartError) throw liftOffStartError;
          }
          break;
        }

        // Quick Payment (mobile_more_tab_condensed_widget_hub_sept30.md)
        // — a coach-initiated one-off charge, no coach_package_id at
        // all, so it has to be caught here before the generic
        // athleteId/groupId/coachPackageId extraction below (which
        // assumes a package purchase).
        if (purchaseKind === "quick_payment") {
          const coachId = session.metadata?.coach_id;
          const quickAthleteId = session.metadata?.athlete_id;
          const quickGroupId = session.metadata?.group_id;
          if (!coachId || !quickAthleteId || !quickGroupId) break;
          if (!(await eventAccountMatchesGroup(supabase, connectedAccount, quickGroupId))) break;

          const { error: insertError } = await supabase.from("coach_quick_payments").insert({
            stripe_event_id: event.id,
            stripe_checkout_session_id: session.id,
            coach_id: coachId,
            athlete_id: quickAthleteId,
            group_id: quickGroupId,
            amount_cents: session.amount_total ?? 0,
            description: session.metadata?.description || null,
          });
          if (insertError) {
            if (insertError.code === "23505") break; // already processed this event
            throw insertError;
          }
          // The coach is told (best effort; only the first time this event is handled).
          await notifyPaymentReceived(supabase, { groupId: quickGroupId, athleteId: quickAthleteId, amountCents: session.amount_total ?? 0, what: session.metadata?.description || "a quick payment" });
          break;
        }

        const athleteId = session.metadata?.athlete_id;
        const groupId = session.metadata?.group_id;
        const coachPackageId = session.metadata?.coach_package_id ?? null;
        if (!athleteId || !groupId) break;
        if (!(await eventAccountMatchesGroup(supabase, connectedAccount, groupId))) break;

        if (session.mode === "payment") {
          // Only a settled payment puts sessions on the account (a bank debit is unpaid at checkout and arrives with its own later event).
          if (session.payment_status !== "paid") break;
          const credits = Number(session.metadata?.credits ?? 0);
          // A team, program or coaching package (0440) grants no sessions but is still a purchase of a package: it is recorded, and its program copy and group access below still happen.
          // Anything else with no sessions is not one of these purchases.
          if (!Number.isInteger(credits) || credits < 0 || (credits === 0 && !coachPackageId)) break;

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
                .neq("stripe_event_id", event.id)
            : { count: 0 };

          // The event is recorded and the sessions are granted in ONE database step: if the grant fails the record is rolled back with it, so Stripe's retry grants again (before, the
          // record survived a failed grant and the retry skipped it: a client paid and got nothing). A repeat of an event that was fully handled changes nothing and returns false.
          const { data: granted, error: grantOnceError } = await supabase.rpc("grant_purchase_once", {
            p_event_id: event.id,
            p_session_id: session.id,
            p_athlete_id: athleteId,
            p_group_id: groupId,
            p_package_id: coachPackageId,
            p_credits: credits,
            p_amount_cents: session.amount_total ?? 0,
            p_note: "Package purchased",
          });
          if (grantOnceError) throw grantOnceError;
          // The coach is told, once: a repeat of an event that was already handled returns false and tells nobody again.
          if (granted === true) await notifyPaymentReceived(supabase, { groupId, athleteId, amountCents: session.amount_total ?? 0, what: credits > 0 ? `${credits} session${credits === 1 ? "" : "s"}` : "a package" });
          // Everything below is safe to run again on a retry (the program copy, the group access and the outside notice each check themselves).

          await assignLinkedProgramIfFirstEnrollment(supabase, {
            coachPackageId,
            athleteId,
            groupId,
            alreadyEnrolled: (priorPurchaseCount ?? 0) > 0,
          });
          // Access to a group the package includes (a no-op for a package without one, and for someone already in the group).
          await grantGroupAccessLogged(supabase, coachPackageId, athleteId);
          await dispatchPackagePurchasedEvent(supabase, {
            groupId,
            coachPackageId,
            athleteId,
            creditsPurchased: credits,
            amountCents: session.amount_total ?? 0,
            eventKey: event.id,
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

          // A failed write must not be answered with "received": Stripe would never try again and a paying client would have no subscription.
          const { error: newSubscriptionError } = await supabase.from("membership_subscriptions").upsert(
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
          if (newSubscriptionError) throw newSubscriptionError;

          await assignLinkedProgramIfFirstEnrollment(supabase, {
            coachPackageId,
            athleteId,
            groupId,
            alreadyEnrolled: !!existingSubscription,
          });
          await grantGroupAccessLogged(supabase, coachPackageId, athleteId);
          await dispatchPackagePurchasedEvent(supabase, {
            groupId,
            coachPackageId,
            athleteId,
            creditsPurchased: null,
            amountCents: session.amount_total ?? 0,
            eventKey: event.id,
          });
        }
        break;
      }

      // A subscription-type package needs sessions_granted credits added
      // every billing cycle, not just once at signup — the status-only
      // tracking above never grants recurring credits on its own.
      // Invoices don't inherit subscription metadata automatically, so
      // the subscription itself has to be fetched to read it.
      // Each renewal is charged at the rate of the organization's plan at that moment (1% or 5%), not the rate on the day they subscribed. Never fails the event: Stripe holds an invoice while this endpoint answers with an
      // error, and a client's renewal must not wait on Spotlight's fee.
      case "invoice.created": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!connectedAccount || invoice.status !== "draft" || invoice.billing_reason !== "subscription_cycle") break;
        try {
          const subscriptionRef = invoice.parent?.subscription_details?.subscription;
          const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
          if (!subscriptionId) break;
          const groupId = (await eventStripe.subscriptions.retrieve(subscriptionId)).metadata?.group_id;
          if (!groupId) break;
          const payee = await getPayeeForGroup(supabase, groupId);
          if (payee.accountId !== connectedAccount || !payee.organizationId) break;
          const feeCents = platformFeeCents(invoice.amount_due ?? 0, await feePercentForOrg(supabase, payee.organizationId));
          await eventStripe.invoices.update(invoice.id!, { application_fee_amount: feeCents });
        } catch (err) {
          console.error("stripe webhook: could not set this renewal's fee; it keeps the subscription's rate", err instanceof Error ? err.message : err);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // Newer Stripe API versions moved the subscription reference off
        // the invoice itself onto parent.subscription_details.subscription
        // (same class of API-version drift already noted for
        // current_period_end elsewhere in this file).
        const subscriptionRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
        if (!subscriptionId) break;

        const subscription = await eventStripe.subscriptions.retrieve(subscriptionId);
        if (connectedAccount && isPlatformOnlyPurchase(subscription.metadata?.purchase_kind)) break;

        // Lift Off's own recurring grant — every cycle including the
        // first, same idempotent-insert-then-RPC shape as the
        // client-billing subscription grant below.
        if (subscription.metadata?.purchase_kind === "coach_lift_off") {
          const coachId = subscription.metadata?.coach_id;
          if (!coachId) break;

          // Recorded and added in one database step (see grant_coach_credit_pack_once above).
          const { error: liftOffGrantError } = await supabase.rpc("grant_lift_off_credits_once", {
            p_event_id: event.id,
            p_coach_id: coachId,
            p_credits: LIFT_OFF_MONTHLY_CREDITS,
          });
          if (liftOffGrantError) throw liftOffGrantError;
          break;
        }

        const athleteId = subscription.metadata?.athlete_id;
        const groupId = subscription.metadata?.group_id;
        const coachPackageId = subscription.metadata?.coach_package_id ?? null;
        if (!athleteId || !groupId || !coachPackageId) break;
        if (!(await eventAccountMatchesGroup(supabase, connectedAccount, groupId))) break;

        const { data: pkg } = await supabase
          .from("coach_packages")
          .select("sessions_granted")
          .eq("id", coachPackageId)
          .maybeSingle();
        if (!pkg) break;

        // What the subscriber bought: the credit count written on the subscription at checkout. A coach editing the package later makes a new price for NEW subscribers only, so the live package row must
        // not decide what an existing subscriber gets. A subscription made before the count was written falls back to the package's current number, as it always did.
        const boughtCredits = Number(subscription.metadata?.credits);
        const renewalCredits = Number.isInteger(boughtCredits) && boughtCredits > 0 ? boughtCredits : pkg.sessions_granted;

        // Recorded and granted in one database step (see grant_purchase_once above); a repeat of a fully handled event returns false.
        const { data: renewalGranted, error: renewalError } = await supabase.rpc("grant_subscription_credits_once", {
          p_event_id: event.id,
          p_athlete_id: athleteId,
          p_group_id: groupId,
          p_package_id: coachPackageId,
          p_credits: renewalCredits,
          p_note: "Membership renewed",
        });
        if (renewalError) throw renewalError;
        if (renewalGranted === true) await notifyPaymentReceived(supabase, { groupId, athleteId, amountCents: invoice.amount_paid ?? 0, what: "a membership renewal" });

        // A paid invoice gives back the group access a lapse took away (a no-op for someone who already has it).
        await grantGroupAccessLogged(supabase, coachPackageId, athleteId);

        await dispatchPackagePurchasedEvent(supabase, {
          groupId,
          coachPackageId,
          athleteId,
          creditsPurchased: renewalCredits,
          amountCents: invoice.amount_paid ?? 0,
          eventKey: event.id,
        });
        break;
      }

      // Money problems (Release M1): a failed payment, a refund made in Stripe, a dispute opened or closed. Each is RECORDED and the coach is told; no balance, session or access is changed and no money moves
      // (lib/payment-events.ts). Needs these four event types switched on for the webhook in the Stripe dashboard.
      case "invoice.payment_failed":
      case "charge.refunded":
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        // Refunds and disputes happen on the coach's own account and are read there. The coach handles them in Stripe. Spotlight moves no money.
        await handlePaymentProblemEvent(event, { db: supabase, stripe: eventStripe });
        break;
      }

      // An organization's Stripe account changed: whether clients can pay it depends on this.
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const { error: connectStatusError } = await supabase
          .from("org_connect_accounts")
          .update({ status: connectStatusFromAccount(account), updated_at: new Date().toISOString() })
          .eq("stripe_account_id", account.id);
        if (connectStatusError) throw connectStatusError;
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
        if (connectedAccount && isPlatformOnlyPurchase(subscription.metadata?.purchase_kind)) break;

        if (subscription.metadata?.purchase_kind === "coach_lift_off") {
          const coachId = subscription.metadata?.coach_id;
          if (!coachId) break;
          const LIFT_OFF_STATUSES = ["active", "past_due", "canceled", "incomplete"] as const;
          const liftOffStatus =
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : (LIFT_OFF_STATUSES as readonly string[]).includes(subscription.status)
                ? (subscription.status as (typeof LIFT_OFF_STATUSES)[number])
                : null;
          if (!liftOffStatus) break;
          const liftOffPeriodEndUnix = subscription.items.data[0]?.current_period_end;
          const { error: liftOffError } = await supabase.from("lift_off_subscriptions").upsert(
            {
              coach_id: coachId,
              stripe_subscription_id: subscription.id,
              status: liftOffStatus,
              current_period_end: liftOffPeriodEndUnix ? new Date(liftOffPeriodEndUnix * 1000).toISOString() : null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "coach_id" }
          );
          if (liftOffError) throw liftOffError;
          break;
        }

        const athleteId = subscription.metadata?.athlete_id;
        const groupId = subscription.metadata?.group_id;
        if (!athleteId || !groupId) break;
        if (!(await eventAccountMatchesGroup(supabase, connectedAccount, groupId))) break;

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
        // canceled, unpaid and a first payment that never completed (incomplete_expired) all count as LAPSED and are stored as canceled; past_due is a grace period (lib/subscription-status.ts).
        const status = storedSubscriptionStatus(event.type, subscription.status);
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

        // An event about an OLDER subscription (the client cancelled one and bought another, and the first one's end arrives late) must not overwrite the current one: it would mark a paying client lapsed
        // and take their group access away. Ignored when the row belongs to a different subscription that is still running.
        const { data: currentRow, error: currentRowError } = await supabase
          .from("membership_subscriptions")
          .select("stripe_subscription_id, status")
          .eq("athlete_id", athleteId)
          .eq("group_id", groupId)
          .maybeSingle();
        if (currentRowError) throw currentRowError;
        if (currentRow && currentRow.stripe_subscription_id && currentRow.stripe_subscription_id !== subscription.id && currentRow.status !== "canceled") {
          console.error("stripe webhook: ignored an event for an older subscription than the current one");
          break;
        }

        const { error: subscriptionUpsertError } = await supabase.from("membership_subscriptions").upsert(
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
        if (subscriptionUpsertError) throw subscriptionUpsertError;
        // A subscription that has ended ends the group access it gave. The program copy stays; the sessions follow their own expiry rule.
        if (endsGroupAccess(status)) {
          await revokeLinkedGroupAccess(supabase, { coachPackageId: subscription.metadata?.coach_package_id ?? null, athleteId });
        }
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
