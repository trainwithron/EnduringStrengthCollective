import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { CREDIT_PACK_CREDITS } from "@/lib/coach-credits";
import { appOrigin } from "@/lib/app-url";
import { packFor } from "@/lib/ai-budget";
import { resolveOrg } from "@/lib/ai-budget-server";

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
      { error: "Payments aren't set up yet." },
      { status: 503 }
    );
  }

  const { kind, groupId, pack } = await request.json();
  if (kind !== "credit_pack" && kind !== "lift_off" && kind !== "ai_topup") {
    return NextResponse.json({ error: "Invalid purchase kind." }, { status: 400 });
  }
  if (!groupId || typeof groupId !== "string") {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }
  // An AI top-up is one of the fixed packs (lib/ai-budget.ts TOP_UP_PACKS); the dollar amount it adds is looked up from the pack on our side, never taken from the request.
  const topUpPack = kind === "ai_topup" ? packFor(Number(pack)) : null;
  if (kind === "ai_topup" && !topUpPack) {
    return NextResponse.json({ error: "Invalid top-up pack." }, { status: 400 });
  }

  const priceId =
    kind === "credit_pack"
      ? process.env.STRIPE_PRICE_COACH_CREDIT_PACK
      : kind === "lift_off"
        ? process.env.STRIPE_PRICE_COACH_LIFT_OFF
        : topUpPack?.cents === 500
          ? process.env.STRIPE_PRICE_AI_TOPUP_5
          : process.env.STRIPE_PRICE_AI_TOPUP_10;
  if (!priceId) {
    return NextResponse.json(
      { error: "This purchase isn't available yet." },
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

    // An AI top-up adds to the organization's pool, so the buyer must belong to an organization (a coach does). The organization id rides along in the metadata for the webhook.
    let organizationId: string | null = null;
    if (kind === "ai_topup") {
      organizationId = await resolveOrg(serviceRole, user.id);
      if (!organizationId) {
        return NextResponse.json({ error: "Only a coach can buy an AI top-up." }, { status: 403 });
      }
    }

    const purchaseKind = kind === "credit_pack" ? "coach_credit_pack" : kind === "lift_off" ? "coach_lift_off" : "ai_topup";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: kind === "lift_off" ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/groups/${groupId}/branding?tab=credits&purchase=success`,
      cancel_url: `${origin}/groups/${groupId}/branding?tab=credits&purchase=canceled`,
      metadata:
        kind === "ai_topup"
          ? { purchase_kind: purchaseKind, coach_id: user.id, organization_id: organizationId ?? "", pack_cents: String(topUpPack?.cents ?? 0) }
          : { purchase_kind: purchaseKind, coach_id: user.id, credits: String(CREDIT_PACK_CREDITS) },
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
