import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";

const CREDITS_PER_PACK = 5;

export async function POST(request: Request) {
  const supabase = createServerClient();
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

  const { groupId, kind } = await request.json();
  if (!groupId || (kind !== "credits" && kind !== "subscription")) {
    return NextResponse.json({ error: "Missing or invalid groupId/kind." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "You're not a member of this group." }, { status: 403 });
  }

  const priceId =
    kind === "credits"
      ? process.env.STRIPE_PRICE_SESSION_CREDIT_PACK
      : process.env.STRIPE_PRICE_MEMBERSHIP_MONTHLY;
  if (!priceId) {
    return NextResponse.json(
      {
        error: `Payments aren't fully configured yet — ask your admin to set ${
          kind === "credits" ? "STRIPE_PRICE_SESSION_CREDIT_PACK" : "STRIPE_PRICE_MEMBERSHIP_MONTHLY"
        }.`,
      },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripeClient();
    const serviceRole = createServiceRoleClient();

    // Reuse this person's existing Stripe Customer across every
    // group/org they're in — created lazily on their first checkout.
    const { data: existingCustomer } = await serviceRole
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("profile_id", user.id)
      .maybeSingle();

    let stripeCustomerId = existingCustomer?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      // profiles has no email column — auth.users does, and only the
      // service-role client can read it.
      const { data: authUser } = await serviceRole.auth.admin.getUserById(user.id);
      const customer = await stripe.customers.create({
        email: authUser?.user?.email ?? undefined,
        metadata: { profile_id: user.id },
      });
      stripeCustomerId = customer.id;
      await serviceRole
        .from("stripe_customers")
        .insert({ profile_id: user.id, stripe_customer_id: stripeCustomerId });
    }

    const origin = request.headers.get("origin") ?? new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: kind === "credits" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/groups/${groupId}/billing/success?kind=${kind}`,
      cancel_url: `${origin}/groups/${groupId}/billing/canceled`,
      metadata:
        kind === "credits"
          ? { athlete_id: user.id, group_id: groupId, credits: String(CREDITS_PER_PACK) }
          : { athlete_id: user.id, group_id: groupId },
      // Subscriptions need the same metadata on the subscription object
      // itself — checkout.session.completed for a subscription doesn't
      // carry it through to the customer.subscription.* events later.
      subscription_data:
        kind === "subscription"
          ? { metadata: { athlete_id: user.id, group_id: groupId } }
          : undefined,
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
