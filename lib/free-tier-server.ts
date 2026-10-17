import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveOrgEntitlements, isBillingEnforced, type OrgBillingRow, type SubscriptionStatus } from "@/lib/org-entitlements";
import { resolveOrg, getCoachBudgetStatus } from "@/lib/ai-budget-server";
import { currentAllowancePeriod, FREE_TIER_AI_USES, FREE_TIER_USE_FEATURE, freeTierOutMessage, type FreeTierUseKind } from "@/lib/ai-usage";

// The free tier's AI rules, server side (Ron, Oct 17). EVERYTHING here is behind COACH_BILLING_ENFORCED: with it off, isFreeTierCoach is false without reading anything, so every organization behaves as it
// always has. A coach is on the free tier when their organization's trial ended with no paid plan (lib/org-entitlements.ts). Free-tier coaches get FREE_TIER_AI_USES "big" AI uses a month (a program built, a meal
// plan, a program import) and no other AI: the gate in reserveAiCall refuses everything else, including the nightly briefing and the spotters. A coach who has bought AI credits or a top-up pack is not held to this.

// Whether the coach's organization is on the free tier right now. Any failure to find out means "not free tier" (a coach is never cut off by a read that did not work).
export async function isFreeTierCoach(db: any, coachId: string, now: Date = new Date()): Promise<boolean> {
  if (!isBillingEnforced()) return false;
  try {
    const orgId = await resolveOrg(db, coachId);
    if (!orgId) return false;
    const [{ data: org }, { data: billing }] = await Promise.all([
      db.from("organizations").select("created_at").eq("id", orgId).maybeSingle(),
      db
        .from("organization_billing")
        .select("billing_exempt, trial_ends_at, subscription_status, current_period_end, org_addon, org_addon_until, past_due_since")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);
    if (!org?.created_at) return false;
    const row: OrgBillingRow | null = billing
      ? {
          billingExempt: !!billing.billing_exempt,
          trialEndsAt: billing.trial_ends_at,
          subscriptionStatus: (billing.subscription_status as SubscriptionStatus | null) ?? null,
          currentPeriodEnd: billing.current_period_end,
          orgAddon: !!billing.org_addon,
          orgAddonUntil: billing.org_addon_until,
          pastDueSince: billing.past_due_since,
        }
      : null;
    return deriveOrgEntitlements(row, new Date(org.created_at), now, true).freeTier;
  } catch {
    return false;
  }
}

// A free-tier coach who has paid for AI (a credit balance, or an AI top-up balance) uses it as anyone does.
export async function hasPaidAiBalance(db: any, coachId: string): Promise<boolean> {
  try {
    const [{ data: credits }, status] = await Promise.all([db.from("coach_credits").select("balance").eq("coach_id", coachId).maybeSingle(), getCoachBudgetStatus(db, coachId)]);
    return (credits?.balance ?? 0) > 0 || (status?.balanceUsd ?? 0) > 0;
  } catch {
    return false;
  }
}

// True when this coach gets NO AI at all outside their monthly free uses (free tier, nothing bought). The scheduled AI jobs skip such a coach before doing any work.
export async function isZeroAiCoach(db: any, coachId: string): Promise<boolean> {
  return (await isFreeTierCoach(db, coachId)) && !(await hasPaidAiBalance(db, coachId));
}

const monthStart = (): string => `${currentAllowancePeriod()}T00:00:00Z`;

const USE_FEATURES = Object.values(FREE_TIER_USE_FEATURE);

// This month's big uses (every attempt counts: a failed or cut-off one too).
export async function freeTierUsesThisMonth(db: any, coachId: string): Promise<number | null> {
  const { count, error } = await db.from("ai_usage_log").select("id", { count: "exact", head: true }).eq("coach_id", coachId).in("feature", USE_FEATURES).gte("created_at", monthStart());
  return error ? null : count ?? 0;
}

// Takes one of the coach's free uses for a big action, before the action runs. Not on the free tier (or paid): nothing is taken and it is allowed. The row is written first and then counted, so two requests
// at once cannot both take the last one: whoever finds more than the allowance gives their row back.
export async function takeFreeTierUse(db: any, coachId: string, kind: FreeTierUseKind): Promise<{ ok: true; free: boolean; used?: number } | { ok: false; error: string }> {
  if (!(await isFreeTierCoach(db, coachId))) return { ok: true, free: false };
  if (await hasPaidAiBalance(db, coachId)) return { ok: true, free: false };
  const unavailable = { ok: false as const, error: "AI is briefly unavailable. Try again in a moment." };
  const before = await freeTierUsesThisMonth(db, coachId);
  if (before == null) return unavailable;
  if (before >= FREE_TIER_AI_USES) return { ok: false, error: freeTierOutMessage() };
  const { data: inserted, error } = await db
    .from("ai_usage_log")
    .insert({ user_id: coachId, coach_id: coachId, feature: FREE_TIER_USE_FEATURE[kind], status: "ok", completed_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  if (error || !inserted?.id) return unavailable;
  const after = await freeTierUsesThisMonth(db, coachId);
  if (after == null || after > FREE_TIER_AI_USES) {
    await db.from("ai_usage_log").delete().eq("id", inserted.id);
    return after == null ? unavailable : { ok: false, error: freeTierOutMessage() };
  }
  return { ok: true, free: true, used: after };
}

// For an AI route: the 402 to return when the coach has no free use left, or null to go ahead.
export async function freeTierUseOrRefuse(coachId: string, kind: FreeTierUseKind): Promise<NextResponse | null> {
  const result = await takeFreeTierUse(createServiceRoleClient(), coachId, kind);
  return result.ok ? null : NextResponse.json({ error: result.error }, { status: 402 });
}

export interface FreeTierMeter {
  freeTier: boolean;
  used: number;
  limit: number;
  left: number;
}

// What the "3 of 5 AI uses left this month" line shows. freeTier false = show nothing (the normal AI meter applies).
export async function freeTierMeter(db: any, coachId: string): Promise<FreeTierMeter> {
  const none: FreeTierMeter = { freeTier: false, used: 0, limit: FREE_TIER_AI_USES, left: FREE_TIER_AI_USES };
  if (!(await isFreeTierCoach(db, coachId))) return none;
  if (await hasPaidAiBalance(db, coachId)) return none;
  const used = (await freeTierUsesThisMonth(db, coachId)) ?? 0;
  return { freeTier: true, used, limit: FREE_TIER_AI_USES, left: Math.max(0, FREE_TIER_AI_USES - used) };
}
