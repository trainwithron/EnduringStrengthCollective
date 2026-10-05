import type { SupabaseClient } from "@supabase/supabase-js";
import { computePlanQuote, type PlanQuote } from "@/lib/coach-plan-pricing";
import {
  deriveOrgEntitlements,
  isBillingEnforced,
  type OrgBillingRow,
  type OrgEntitlements,
  type SubscriptionStatus,
} from "@/lib/org-entitlements";

export interface OrgBillingSummary {
  entitlements: OrgEntitlements;
  quote: PlanQuote;
  exemptReason: string | null;
}

// Everything the Plan & Billing tab shows, read under the caller's own
// session (RLS lets org members read their org's billing row; the two
// count functions authorize the same way). A missing row is a normal
// non-exempt org on its free trial.
export async function getOrgBillingSummary(
  supabase: SupabaseClient,
  organizationId: string,
  orgCreatedAt: string
): Promise<OrgBillingSummary> {
  const [{ data: billing }, clientsRes, seatsRes] = await Promise.all([
    supabase
      .from("organization_billing")
      .select(
        "billing_exempt, exempt_reason, trial_ends_at, subscription_status, current_period_end, org_addon, org_addon_until, past_due_since"
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase.rpc("org_billable_clients", { p_org_id: organizationId }),
    supabase.rpc("org_coach_seats", { p_org_id: organizationId }),
  ]);

  const row: OrgBillingRow | null = billing
    ? {
        billingExempt: billing.billing_exempt,
        trialEndsAt: billing.trial_ends_at,
        subscriptionStatus: (billing.subscription_status as SubscriptionStatus | null) ?? null,
        currentPeriodEnd: billing.current_period_end,
        orgAddon: billing.org_addon,
        orgAddonUntil: billing.org_addon_until,
        pastDueSince: billing.past_due_since,
      }
    : null;

  const entitlements = deriveOrgEntitlements(row, new Date(orgCreatedAt), new Date(), isBillingEnforced());

  // The quote shows what the plan WOULD cost at the org's current size:
  // add-on included during a trial (everything is), otherwise as chosen.
  const quote = computePlanQuote({
    clients: (clientsRes.data as number | null) ?? 0,
    coachSeats: (seatsRes.data as number | null) ?? 1,
    orgAddon: row?.orgAddon ?? false,
  });

  return { entitlements, quote, exemptReason: billing?.exempt_reason ?? null };
}
