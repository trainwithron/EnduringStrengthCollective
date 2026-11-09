import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isStripeConfigured } from "@/lib/stripe";
import { getOrgConnect } from "@/lib/connect-payee";

// Where the owner sees their payments, payouts and bank account: their own Stripe dashboard (a Standard account signs in there itself, so there is no one-time link to make).
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });

  const { groupId } = await request.json();
  if (!groupId) return NextResponse.json({ error: "Missing groupId." }, { status: 400 });

  const { data: group } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  if (!group?.organization_id) return NextResponse.json({ error: "This space has no organization." }, { status: 404 });
  const { data: membership } = await supabase.from("organization_memberships").select("role").eq("organization_id", group.organization_id).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Only the organization's owner can open its Stripe account." }, { status: 403 });

  const connect = await getOrgConnect(createServiceRoleClient(), group.organization_id);
  if (connect.status !== "ready" || !connect.accountId) return NextResponse.json({ error: "Finish setting up Stripe first." }, { status: 409 });

  return NextResponse.json({ url: "https://dashboard.stripe.com" });
}
