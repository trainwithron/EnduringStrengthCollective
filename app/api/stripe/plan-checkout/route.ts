import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appOrigin } from "@/lib/app-url";
import { rateLimitResponse } from "@/lib/rate-limit";
import { safeErrorDetail } from "@/lib/safe-error";
import { billingRowFrom, ORG_BILLING_COLUMNS } from "@/lib/org-billing-server";
import { deriveOrgEntitlements, isBillingEnforced } from "@/lib/org-entitlements";
import { canBuyCoachPlan, COACH_PLAN_PURCHASE_KIND, coachPlanPriceId, isLivePlanStatus } from "@/lib/coach-plan-checkout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The organization's owner buys the coach plan (Ron, Nov 20): a Stripe Checkout on Spotlight's own account for the price Ron created (STRIPE_PRICE_COACH_PLAN). Nothing is charged here; the webhook
// records the subscription when Stripe says it started (app/api/stripe/webhook/route.ts, purchase kind coach_plan). Only the owner, only an organization that is not exempt and not already paying.
// { organizationId, groupId }   (groupId: the page to come back to)
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limited = await rateLimitResponse("plan-checkout", user.id, 20, 3600);
  if (limited) return limited;

  const raw = (await request.json().catch(() => ({}))) as { organizationId?: unknown; groupId?: unknown };
  const organizationId = typeof raw.organizationId === "string" && UUID.test(raw.organizationId) ? raw.organizationId : null;
  const groupId = typeof raw.groupId === "string" && UUID.test(raw.groupId) ? raw.groupId : null;
  if (!organizationId) return NextResponse.json({ error: "Missing the organization." }, { status: 400 });

  const priceId = coachPlanPriceId();
  if (!isStripeConfigured() || !priceId) return NextResponse.json({ error: "The paid plan isn't available yet." }, { status: 503 });

  // the owner, read under their own sign-in
  const { data: membership } = await supabase.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("profile_id", user.id).maybeSingle();
  if ((membership as { role?: string } | null)?.role !== "owner") return NextResponse.json({ error: "Only the organization's owner can choose a plan." }, { status: 403 });

  const db = createServiceRoleClient();
  const [{ data: org }, { data: billing, error: billingError }] = await Promise.all([
    db.from("organizations").select("created_at").eq("id", organizationId).maybeSingle(),
    db.from("organization_billing").select(`${ORG_BILLING_COLUMNS}, stripe_customer_id`).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!org || billingError) return NextResponse.json({ error: "Couldn't read the organization's plan. Try again." }, { status: 502 });
  const row = billing ? billingRowFrom(billing as Parameters<typeof billingRowFrom>[0]) : null;
  const plan = deriveOrgEntitlements(row, new Date((org as { created_at: string }).created_at), new Date(), isBillingEnforced());
  if (plan.state === "exempt") return NextResponse.json({ error: "This organization isn't charged for the plan." }, { status: 409 });
  if (!canBuyCoachPlan(plan)) return NextResponse.json({ error: "This organization already has a plan." }, { status: 409 });

  try {
    const stripe = getStripeClient();
    // One Stripe customer per organization, on Spotlight's own account (the plan is billed per organization).
    let customerId = (billing as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      // the same key for the same organization: two first clicks at once make one customer
      const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { organization_id: organizationId, owner_id: user.id } }, { idempotencyKey: `coach-plan-customer-${organizationId}` });
      customerId = customer.id;
      const { error: saveError } = await db.from("organization_billing").upsert({ organization_id: organizationId, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
      if (saveError) return NextResponse.json({ error: "Couldn't start checkout. Try again." }, { status: 502 });
    }

    // Never two plans (Assistant review of 5db6fa62): a plan Stripe already has for this organization (paid a moment ago, before the webhook arrived) stops a new checkout, and a checkout
    // still open in another tab is closed first, so only one can ever be paid.
    const existing = await stripe.subscriptions.list({ customer: customerId, price: priceId, status: "all", limit: 20 });
    const live = existing.data.filter((s) => isLivePlanStatus(s.status));
    // a first payment still waiting on the bank's check (left unfinished): Stripe closes it within a day
    if (live.length > 0 && live.every((s) => s.status === "incomplete"))
      return NextResponse.json({ error: "Your last checkout is still waiting for your bank to confirm the card. Finish it in that window, or try again tomorrow (an unfinished one closes within a day)." }, { status: 409 });
    if (live.length > 0) return NextResponse.json({ error: "This organization already has a plan." }, { status: 409 });
    const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
    for (const s of open.data) if (s.metadata?.purchase_kind === COACH_PLAN_PURCHASE_KIND) await stripe.checkout.sessions.expire(s.id);

    const origin = appOrigin(request);
    const back = groupId ? `${origin}/groups/${groupId}/branding?tab=billing` : `${origin}/dashboard`;
    const metadata = { purchase_kind: COACH_PLAN_PURCHASE_KIND, organization_id: organizationId, coach_id: user.id };
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: organizationId,
      success_url: `${back}${groupId ? "&" : "?"}plan=started`,
      cancel_url: `${back}${groupId ? "&" : "?"}plan=canceled`,
      metadata,
      subscription_data: { metadata },
    });
    if (!session.url) return NextResponse.json({ error: "Couldn't start checkout. Try again." }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json({ error: `Couldn't start checkout: ${safeErrorDetail(err)}` }, { status: 502 });
  }
}
