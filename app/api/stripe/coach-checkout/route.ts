import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { CREDIT_PACK_CREDITS } from "@/lib/coach-credits";
import { appOrigin } from "@/lib/app-url";

// credit_topup_low_tier_monetization_idea.md — a coach buying their OWN
// AI credits/Lift Off from the platform, genuinely distinct from
// app/api/stripe/checkout/route.ts (a coach's CLIENT paying the coach).
// Global, fixed pricing (same $5 for every coach, not per-coach custom
// pricing like coach_packages), so this uses one shared Stripe Price
// per kind via env vars — the same pattern this app used before
// coach_packages needed per-coach pricing, reused here because this
// feature genuinely doesn't need that flexibility.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments aren't configured yet — ask your admin to add a STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const { kind, groupId } = await request.json();
  if (kind !== "credit_pack" && kind !== "lift_off") {
    return NextResponse.json({ error: "Invalid purchase kind." }, { status: 400 });
  }
  if (!groupId || typeof groupId !== "string") {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const priceId =
    kind === "credit_pack" ? process.env.STRIPE_PRICE_COACH_CREDIT_PACK : process.env.STRIPE_PRICE_COACH_LIFT_OFF;
  if (!priceId) {
    return NextResponse.json(
      { error: "This purchase isn't configured yet — ask your admin to add the Stripe price id." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripeClient();
    const serviceRole = createServiceRoleClient();

    // Same Stripe Customer every other purchase in this app reuses
    // (stripe_customers, keyed by profile_id) — a coach is just another
    // consumer of that mapping.
    const { data: existingCustomer } = await serviceRole
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("profile_id", user.id)
      .maybeSingle();

    let stripeCustomerId = existingCustomer?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const { data: authUser } = await serviceRole.auth.admin.getUserById(user.id);
      const customer = await stripe.customers.create({
        email: authUser?.user?.email ?? undefined,
        metadata: { profile_id: user.id },
      });
      stripeCustomerId = customer.id;
      await serviceRole.from("stripe_customers").insert({ profile_id: user.id, stripe_customer_id: stripeCustomerId });
    }

    const origin = appOrigin(request);
    const purchaseKind = kind === "credit_pack" ? "coach_credit_pack" : "coach_lift_off";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: kind === "credit_pack" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/groups/${groupId}/branding?tab=credits&purchase=success`,
      cancel_url: `${origin}/groups/${groupId}/branding?tab=credits&purchase=canceled`,
      metadata: { purchase_kind: purchaseKind, coach_id: user.id, credits: String(CREDIT_PACK_CREDITS) },
      subscription_data:
        kind === "lift_off" ? { metadata: { purchase_kind: purchaseKind, coach_id: user.id } } : undefined,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Couldn't create a checkout session." }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't start checkout: ${message}` }, { status: 502 });
  }
}
