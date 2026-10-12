import type { SupabaseClient } from "@supabase/supabase-js";
import { computeEstimatedMRR, computeRealMRR } from "@/lib/business-metrics";
import { ratesByMembership } from "@/lib/client-rates";
import { loadBusinessScope } from "@/lib/business-scope";

// The one number a coach is shown as "MRR": real subscriptions when there are any, otherwise the estimate from the monthly rates set by hand. The Business page and the phone Home
// both read it through here, so the two can never disagree.
export function headlineMrr(realMrr: number, estimatedMrr: number): { value: number; estimated: boolean } {
  return realMrr > 0 ? { value: realMrr, estimated: false } : { value: estimatedMrr, estimated: true };
}

const NO_GROUP = "00000000-0000-0000-0000-000000000000";

// The coach's MRR across EVERY group they coach (a 1-on-1 coach has one group per client, so one group alone is nearly always $0), as the Business page reads it.
export async function loadCoachMrr(supabase: SupabaseClient, coachId: string, groupId: string): Promise<{ value: number; estimated: boolean }> {
  // Only the organization the page is in (never another organization's income): the coach's own groups, or every group of the organization for its owner or an admin.
  const ids = (await loadBusinessScope(supabase, coachId, groupId)).groupIds;
  const groupIds = ids.length > 0 ? ids : [NO_GROUP];
  const [{ data: subRows }, { data: memberRows }, { data: rateRows }] = await Promise.all([
    supabase.from("membership_subscriptions").select("price_cents, status").in("group_id", groupIds),
    supabase.from("group_memberships").select("id").in("group_id", groupIds).eq("role", "athlete"),
    supabase.from("client_billing_rates").select("membership_id, monthly_rate").in("group_id", groupIds),
  ]);
  const real = computeRealMRR(
    (subRows ?? []).map((s) => ({
      priceCents: s.price_cents,
      status: s.status as "active" | "past_due" | "canceled" | "incomplete" | "paused",
    }))
  );
  const rates = ratesByMembership(rateRows as any);
  const estimated = computeEstimatedMRR((memberRows ?? []).map((m) => ({ monthlyRate: rates.get(m.id as string) ?? null })));
  return headlineMrr(real, estimated);
}
