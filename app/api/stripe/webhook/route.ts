import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import type Stripe from "stripe";

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
        } else if (session.mode === "subscription" && typeof session.subscription === "string") {
          await supabase.from("membership_subscriptions").upsert(
            {
              athlete_id: athleteId,
              group_id: groupId,
              stripe_subscription_id: session.subscription,
              status: "active",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "athlete_id,group_id" }
          );
        }
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
