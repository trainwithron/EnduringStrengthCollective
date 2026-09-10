import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";

// Creates (or reuses) a Stripe Express connected account for the calling
// coach and returns a fresh onboarding link — the coach completes the
// actual identity/bank-account verification on Stripe's own hosted page,
// never inside this app. Called from the Revenue Splits page's "Connect
// Stripe" button.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments aren't configured yet — ask your admin to add a STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const { organizationId, groupId } = await request.json();
  if (!organizationId || !groupId) {
    return NextResponse.json({ error: "Missing organizationId or groupId." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("stripe_connect_account_id")
    .eq("organization_id", organizationId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "You're not a member of this organization." }, { status: 403 });
  }

  const stripe = getStripeClient();
  const serviceRole = createServiceRoleClient();
  let accountId = membership.stripe_connect_account_id;

  try {
    if (!accountId) {
      const { data: authUser } = await serviceRole.auth.admin.getUserById(user.id);
      const account = await stripe.accounts.create({
        type: "express",
        email: authUser.user?.email,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      await serviceRole
        .from("organization_memberships")
        .update({ stripe_connect_account_id: accountId, stripe_connect_status: "pending" })
        .eq("organization_id", organizationId)
        .eq("profile_id", user.id);
    }

    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/groups/${groupId}/revenue-splits`,
      return_url: `${origin}/groups/${groupId}/revenue-splits`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't start Stripe onboarding.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
