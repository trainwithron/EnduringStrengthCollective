import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingRowFrom, ORG_BILLING_COLUMNS } from "@/lib/org-billing-server";
import { deriveOrgEntitlements, isBillingEnforced } from "@/lib/org-entitlements";
import { platformFeePercent } from "@/lib/platform-fee";
import { packagePriceCents } from "@/lib/package-price";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Who gets paid when a client pays: always the organization's own Stripe account (a solo coach's organization is theirs). Every client payment is a direct charge on that account (Ron, Nov 9: "I would never
// hold any of anybody's money"). Spotlight never holds, splits or sends on that money; it only takes its application fee. Every function here runs with the service role, after the route has checked who is asking.

export type ConnectStatus = "not_connected" | "pending" | "ready";

export const PAYEE_NOT_READY_FOR_CLIENT = "Your coach isn't set up to take payments in the app yet. Ask them how to pay.";
export const PAYEE_NOT_READY_FOR_COACH = "Connect Stripe on your Packages page before charging a client. Only the organization's owner can do that.";

export function connectStatusFromAccount(account: Pick<Stripe.Account, "details_submitted" | "charges_enabled">): Exclude<ConnectStatus, "not_connected"> {
  return account.details_submitted && account.charges_enabled ? "ready" : "pending";
}

export interface OrgConnect {
  accountId: string | null;
  status: ConnectStatus;
}

// A failed read (the paste not applied yet, a passing fault) is "not connected": nothing can be charged, and saving and hand-assigning packages carry on.
export async function getOrgConnect(db: SupabaseClient, organizationId: string): Promise<OrgConnect> {
  const { data, error } = await db.from("org_connect_accounts").select("stripe_account_id, status").eq("organization_id", organizationId).maybeSingle();
  if (error || !data) return { accountId: null, status: "not_connected" };
  return { accountId: data.stripe_account_id as string, status: data.status === "ready" ? "ready" : "pending" };
}

export interface Payee extends OrgConnect {
  organizationId: string | null;
  ready: boolean;
}

export async function getPayeeForGroup(db: SupabaseClient, groupId: string): Promise<Payee> {
  const { data: group } = await db.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  const organizationId = (group?.organization_id as string | null | undefined) ?? null;
  if (!organizationId) return { organizationId: null, accountId: null, status: "not_connected", ready: false };
  const connect = await getOrgConnect(db, organizationId);
  return { organizationId, ...connect, ready: connect.status === "ready" && !!connect.accountId };
}

// For a page deciding whether to show buy buttons. Any failure means no buttons.
export async function payeeReadyForGroup(groupId: string): Promise<boolean> {
  try {
    return (await getPayeeForGroup(createServiceRoleClient(), groupId)).ready;
  } catch {
    return false;
  }
}

// The rate for a charge happening now, from the organization's plan at this moment. A read that fails is thrown: the fee is never guessed.
export async function feePercentForOrg(db: SupabaseClient, organizationId: string): Promise<number> {
  const [billing, org] = await Promise.all([
    db.from("organization_billing").select(ORG_BILLING_COLUMNS).eq("organization_id", organizationId).maybeSingle(),
    db.from("organizations").select("created_at").eq("id", organizationId).single(),
  ]);
  if (billing.error) throw billing.error;
  if (org.error) throw org.error;
  const entitlements = deriveOrgEntitlements(billing.data ? billingRowFrom(billing.data as never) : null, new Date(org.data.created_at as string), new Date(), isBillingEnforced());
  return platformFeePercent(entitlements);
}

// A Stripe customer belongs to one Stripe account, so each client has one per organization they pay. Never the platform's customer id (stripe_customers), which is only for a coach paying Spotlight.
export async function connectedCustomerId(db: SupabaseClient, stripe: Stripe, profileId: string, accountId: string): Promise<string> {
  const read = () => db.from("stripe_connected_customers").select("stripe_customer_id").eq("profile_id", profileId).eq("stripe_account_id", accountId).maybeSingle();
  const { data: existing, error: readError } = await read();
  if (readError) throw readError;
  if (existing) return existing.stripe_customer_id as string;

  const { data: authUser } = await db.auth.admin.getUserById(profileId);
  const customer = await stripe.customers.create({ email: authUser?.user?.email ?? undefined, metadata: { profile_id: profileId } }, { stripeAccount: accountId });
  const { error: saveError } = await db.from("stripe_connected_customers").insert({ profile_id: profileId, stripe_account_id: accountId, stripe_customer_id: customer.id });
  if (!saveError) return customer.id;
  if (saveError.code !== "23505") throw saveError;
  // Two checkouts at once: use the one that was saved first.
  const { data: winner } = await read();
  return (winner?.stripe_customer_id as string | undefined) ?? customer.id;
}

export interface PackageForPrice {
  id: string;
  coach_id: string;
  group_id: string;
  name: string;
  billing_type: string;
  sessions_granted: number;
  rate_cents: number;
  price_cents: number | null;
  stripe_price_id: string | null;
  stripe_account_id?: string | null;
}

// The package's price on the payee's own account, made the first time it is needed. A package saved before the coach connected has none; a price made on any other account (the platform, before Nov 9) cannot be used.
export async function ensurePackagePrice(db: SupabaseClient, stripe: Stripe, pkg: PackageForPrice, accountId: string): Promise<string> {
  if (pkg.stripe_price_id && pkg.stripe_account_id === accountId) return pkg.stripe_price_id;
  const onAccount = { stripeAccount: accountId };
  const product = await stripe.products.create({ name: pkg.name, metadata: { coach_id: pkg.coach_id, group_id: pkg.group_id, coach_package_id: pkg.id } }, onAccount);
  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: packagePriceCents({ priceCents: pkg.price_cents, rateCents: pkg.rate_cents, sessionsGranted: pkg.sessions_granted }),
      recurring: pkg.billing_type === "subscription" ? { interval: "month" } : undefined,
    },
    onAccount
  );
  const { error: priceSaveError } = await db.from("coach_packages").update({ stripe_product_id: product.id, stripe_price_id: price.id, stripe_account_id: accountId }).eq("id", pkg.id);
  if (priceSaveError) throw priceSaveError;
  return price.id;
}

// A connected account has no customer portal settings of its own until one is made. Clients can change their card, see invoices and cancel at the end of the period.
export async function portalConfigurationId(stripe: Stripe, accountId: string): Promise<string> {
  const onAccount = { stripeAccount: accountId };
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 1 }, onAccount);
  if (existing.data[0]) return existing.data[0].id;
  const made = await stripe.billingPortal.configurations.create(
    { features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" } } },
    onAccount
  );
  return made.id;
}

// True when a Connect event may act on this group: the account the event came from is the group's own payee. An event from the platform's own account (a payment made before direct charges) has no account and passes.
// A read that fails is thrown so Stripe sends the event again.
export async function eventAccountMatchesGroup(db: SupabaseClient, eventAccount: string | null, groupId: string): Promise<boolean> {
  if (!eventAccount) return true;
  const { data: group, error: groupError } = await db.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  if (groupError) throw groupError;
  if (group?.organization_id) {
    const { data: row, error } = await db.from("org_connect_accounts").select("stripe_account_id").eq("organization_id", group.organization_id).maybeSingle();
    if (error) throw error;
    if (row?.stripe_account_id === eventAccount) return true;
  }
  console.error("stripe webhook: ignored an event whose connected account is not the payee of its group", eventAccount, groupId);
  return false;
}

// What a coach pays Spotlight for. These only ever happen on the platform's own account; the same purchase kind on a connected account is ignored.
const PLATFORM_ONLY_PURCHASES = new Set(["ai_topup", "coach_credit_pack", "coach_lift_off"]);
export function isPlatformOnlyPurchase(kind: string | null | undefined): boolean {
  return !!kind && PLATFORM_ONLY_PURCHASES.has(kind);
}

// The platform endpoint and the Connect endpoint have different signing secrets; an event is genuine if either one matches.
export function constructEventFromSecrets(stripe: Stripe, body: string, signature: string, secrets: string[]): Stripe.Event {
  let lastError: unknown = new Error("No webhook secret is set.");
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(body, signature, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
