import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appOrigin } from "@/lib/app-url";
import { connectedCustomerId, ensurePackagePrice, feePercentForOrg, getPayeeForGroup, PAYEE_NOT_READY_FOR_CLIENT, type PackageForPrice } from "@/lib/connect-payee";
import { platformFeeCents } from "@/lib/platform-fee";
import { packagePriceCents } from "@/lib/package-price";

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

  const { packageId } = await request.json();
  if (!packageId) {
    return NextResponse.json({ error: "Missing packageId." }, { status: 400 });
  }

  // The package's own group_id is what actually gets checked and used —
  // never a client-supplied groupId — so a client can't buy a package
  // that isn't genuinely offered in a group they belong to.
  const { data: pkg } = await supabase
    .from("coach_packages")
    .select("*")
    .eq("id", packageId)
    .maybeSingle();
  if (!pkg || !pkg.is_active) {
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

    // Every client payment is a direct charge on the organization's own Stripe account. Nothing is charged until that account is ready.
    const payee = await getPayeeForGroup(serviceRole, groupId);
    if (!payee.ready || !payee.accountId || !payee.organizationId) {
      return NextResponse.json({ error: PAYEE_NOT_READY_FOR_CLIENT }, { status: 409 });
    }
    const feePercent = await feePercentForOrg(serviceRole, payee.organizationId);
    const stripePriceId = await ensurePackagePrice(serviceRole, stripe, pkg as PackageForPrice, payee.accountId);
    const stripeCustomerId = await connectedCustomerId(serviceRole, stripe, user.id, payee.accountId);

    const origin = appOrigin(request);

    const session = await stripe.checkout.sessions.create(
      {
      customer: stripeCustomerId,
      mode: kind === "credits" ? "payment" : "subscription",
      line_items: [{ price: stripePriceId, quantity: 1 }],
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
          : { athlete_id: user.id, group_id: groupId, coach_package_id: pkg.id, credits: String(pkg.sessions_granted) },
      // Subscriptions need the same metadata on the subscription object
      // itself — checkout.session.completed for a subscription doesn't
      // carry it through to the customer.subscription.* events later.
      subscription_data:
        kind === "subscription"
          ? { application_fee_percent: feePercent, metadata: { athlete_id: user.id, group_id: groupId, coach_package_id: pkg.id, credits: String(pkg.sessions_granted) } }
          : undefined,
      payment_intent_data:
        kind === "credits"
          ? { application_fee_amount: platformFeeCents(packagePriceCents({ priceCents: pkg.price_cents, rateCents: pkg.rate_cents, sessionsGranted: pkg.sessions_granted }), feePercent) }
          : undefined,
      },
      { stripeAccount: payee.accountId }
    );

    if (!session.url) {
      return NextResponse.json({ error: "Couldn't create a checkout session." }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't start checkout: ${message}` }, { status: 502 });
  }
}
