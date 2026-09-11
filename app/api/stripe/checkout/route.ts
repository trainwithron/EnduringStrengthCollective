import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";

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

  const { packageId } = await request.json();
  if (!packageId) {
    return NextResponse.json({ error: "Missing packageId." }, { status: 400 });
  }

  // The package's own group_id is what actually gets checked and used —
  // never a client-supplied groupId — so a client can't buy a package
  // that isn't genuinely offered in a group they belong to.
  const { data: pkg } = await supabase
    .from("coach_packages")
    .select("id, group_id, billing_type, sessions_granted, stripe_price_id, is_active")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg || !pkg.is_active || !pkg.stripe_price_id) {
    return NextResponse.json({ error: "This package isn't available." }, { status: 404 });
  }

  // Checked explicitly here too, not just left to RLS on the coach_packages
  // read above — a genuine training relationship with THIS group
  // specifically, not just any membership row (an access-only second
  // membership to one of this coach's other groups shouldn't be able to
  // buy a package scoped to a group it isn't actually training in).
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role, membership_type")
    .eq("group_id", pkg.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership || membership.role !== "athlete" || membership.membership_type !== "training") {
    return NextResponse.json({ error: "You're not a training client of this group." }, { status: 403 });
  }

  const groupId = pkg.group_id;
  const kind = pkg.billing_type === "one_time" ? "credits" : "subscription";

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
      line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
      success_url: `${origin}/groups/${groupId}/billing/success?kind=${kind}`,
      cancel_url: `${origin}/groups/${groupId}/billing/canceled`,
      metadata:
        kind === "credits"
          ? {
              athlete_id: user.id,
              group_id: groupId,
              coach_package_id: pkg.id,
              credits: String(pkg.sessions_granted),
            }
          : { athlete_id: user.id, group_id: groupId, coach_package_id: pkg.id },
      // Subscriptions need the same metadata on the subscription object
      // itself — checkout.session.completed for a subscription doesn't
      // carry it through to the customer.subscription.* events later.
      subscription_data:
        kind === "subscription"
          ? { metadata: { athlete_id: user.id, group_id: groupId, coach_package_id: pkg.id } }
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
