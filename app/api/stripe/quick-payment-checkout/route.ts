import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appOrigin } from "@/lib/app-url";

// Quick Payment (mobile_more_tab_condensed_widget_hub_sept30.md) — a
// coach-initiated one-off charge to a specific client. Deliberately the
// same Checkout-redirect mechanism the existing package flow already
// uses (app/api/stripe/checkout/route.ts), just with an inline
// price_data line item instead of a pre-existing coach_packages Price —
// there's no package here, only a coach-typed dollar amount. Whoever
// completes the resulting Checkout page pays (the coach handing their
// phone to the client in person is the expected flow, same way an
// in-person point-of-sale works today) — this does not attempt saved-
// card off-session charging, which Tap to Pay (explicitly parked for
// later) would actually need.
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

  const { groupId, athleteId, amountCents, description } = await request.json();
  if (!groupId || !athleteId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Missing or invalid client/amount." }, { status: 400 });
  }
  // A real dollar floor/ceiling — not a business rule, just a sanity
  // guard against a typo (e.g. a stray extra digit) charging someone
  // $100,000 by accident.
  if (amountCents < 100 || amountCents > 100000) {
    return NextResponse.json({ error: "Amount must be between $1 and $1,000." }, { status: 400 });
  }

  // Real coach-of-this-group and real-client-of-this-group checks —
  // never trust a client-supplied groupId/athleteId pairing without
  // verifying both sides independently.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!coachMembership || coachMembership.role !== "coach") {
    return NextResponse.json({ error: "Only a coach of this group can charge a client." }, { status: 403 });
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", athleteId)
    .maybeSingle();
  if (!athleteMembership || athleteMembership.role !== "athlete") {
    return NextResponse.json({ error: "That client isn't in this group." }, { status: 404 });
  }

  try {
    const stripe = getStripeClient();
    const serviceRole = createServiceRoleClient();

    // Reuse the client's existing Stripe Customer across every group/org
    // they're in — same lookup-or-create pattern as the package checkout
    // route, just keyed by the coach-selected athleteId instead of the
    // caller's own id.
    const { data: existingCustomer } = await serviceRole
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("profile_id", athleteId)
      .maybeSingle();

    let stripeCustomerId = existingCustomer?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const { data: authUser } = await serviceRole.auth.admin.getUserById(athleteId);
      const customer = await stripe.customers.create({
        email: authUser?.user?.email ?? undefined,
        metadata: { profile_id: athleteId },
      });
      stripeCustomerId = customer.id;
      await serviceRole
        .from("stripe_customers")
        .insert({ profile_id: athleteId, stripe_customer_id: stripeCustomerId });
    }

    const origin = appOrigin(request);
    const trimmedDescription =
      typeof description === "string" ? description.trim().slice(0, 200) : "";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountCents),
            product_data: { name: trimmedDescription || "Training session" },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/groups/${groupId}/billing/success?kind=quick_payment`,
      cancel_url: `${origin}/groups/${groupId}/billing/canceled`,
      metadata: {
        purchase_kind: "quick_payment",
        coach_id: user.id,
        athlete_id: athleteId,
        group_id: groupId,
        description: trimmedDescription,
      },
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
