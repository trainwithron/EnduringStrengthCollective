import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appOrigin } from "@/lib/app-url";
import { getPayeeForGroup, portalConfigurationId } from "@/lib/connect-payee";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }

  const { groupId } = await request.json().catch(() => ({}));
  const serviceRole = createServiceRoleClient();

  // A client's billing lives on their coach's own Stripe account, and so does the page that manages it.
  if (typeof groupId === "string" && groupId) {
    const payee = await getPayeeForGroup(serviceRole, groupId);
    if (payee.accountId) {
      const { data: connected } = await serviceRole
        .from("stripe_connected_customers")
        .select("stripe_customer_id")
        .eq("profile_id", user.id)
        .eq("stripe_account_id", payee.accountId)
        .maybeSingle();
      if (connected) {
        try {
          const stripe = getStripeClient();
          const session = await stripe.billingPortal.sessions.create(
            { customer: connected.stripe_customer_id, return_url: appOrigin(request), configuration: await portalConfigurationId(stripe, payee.accountId) },
            { stripeAccount: payee.accountId }
          );
          return NextResponse.json({ url: session.url });
        } catch (err) {
          const message = safeErrorDetail(err);
          return NextResponse.json({ error: `Couldn't open billing portal: ${message}` }, { status: 502 });
        }
      }
    }
  }

  // Anyone with billing from before direct charges still manages it on the platform's account. A platform customer id is never used on a connected account.
  const { data: customer } = await serviceRole
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json(
      { error: "No billing history yet — buy credits or subscribe first." },
      { status: 404 }
    );
  }

  try {
    const stripe = getStripeClient();
    const origin = appOrigin(request);
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: origin,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't open billing portal: ${message}` }, { status: 502 });
  }
}
