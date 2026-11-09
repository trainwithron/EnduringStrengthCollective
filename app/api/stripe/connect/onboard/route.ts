import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appOrigin } from "@/lib/app-url";

// Creates (or reuses) the organization's Stripe Express account and returns a fresh onboarding link. The owner signs up or logs in and enters their bank on Stripe's own hosted pages, never in this app.
// The account belongs to the organization: it is the one payee for every client payment, and a solo coach's organization is theirs. Called from the Packages page.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }

  const { groupId } = await request.json();
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const organizationId = group?.organization_id;
  if (!organizationId) {
    return NextResponse.json({ error: "This space has no organization to connect." }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the organization's owner can connect Stripe." }, { status: 403 });
  }

  const stripe = getStripeClient();
  const serviceRole = createServiceRoleClient();

  const { data: existing, error: readError } = await serviceRole
    .from("org_connect_accounts")
    .select("stripe_account_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: "Connecting Stripe isn't switched on yet." }, { status: 503 });
  }
  let accountId: string | null = existing?.stripe_account_id ?? null;

  try {
    if (!accountId) {
      const { data: authUser } = await serviceRole.auth.admin.getUserById(user.id);
      // A Standard account (Ron, Nov 9: "log into their own Stripe account", "I don't want any part of their business"): the coach's own full Stripe account. Stripe lists the account, not the
      // platform, as liable for fraud and disputes on direct charges; on an Express account it would be Spotlight.
      const account = await stripe.accounts.create({
        type: "standard",
        email: authUser.user?.email,
        metadata: { organization_id: organizationId },
      });
      accountId = account.id;
      const { error: saveError } = await serviceRole
        .from("org_connect_accounts")
        .insert({ organization_id: organizationId, stripe_account_id: accountId, status: "pending" });
      if (saveError) {
        // The account must be recorded before the owner is sent to Stripe, or they finish onboarding an account the app does not know and every retry makes another. Take the new account back and say so.
        try {
          await stripe.accounts.del(accountId);
        } catch {
          // an account that cannot be removed stays unused; the owner is still told
        }
        throw saveError;
      }
    }

    const origin = appOrigin(request);
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/groups/${groupId}/business/packages`,
      return_url: `${origin}/groups/${groupId}/business/packages`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    const message = safeErrorDetail(err, "Couldn't start Stripe onboarding.");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
