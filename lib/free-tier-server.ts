import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveOrgEntitlements, isBillingEnforced, type OrgBillingRow, type SubscriptionStatus } from "@/lib/org-entitlements";
import { chunk } from "@/lib/chunk";
import { getCoachBudgetStatus } from "@/lib/ai-budget-server";
import { currentAllowancePeriod, FREE_TIER_AI_USES, FREE_TIER_USE_FEATURE, freeTierOutMessage, type FreeTierUseKind } from "@/lib/ai-usage";

// The free tier's AI rules, server side (Ron, Oct 17). EVERYTHING here is behind COACH_BILLING_ENFORCED: with it off, isFreeTierCoach is false without reading anything, so every organization behaves as it
// always has. An organization is on the free tier when its trial ended with no paid plan, or its plan lapsed (lib/org-entitlements.ts). Free-tier coaches get FREE_TIER_AI_USES "big" AI uses a month (a program
// built, a meal plan, a program import) and no other AI: the gate in reserveAiCall refuses everything else, including the nightly briefing and the spotters. A coach who pays (AI credits, a top-up, an active Lift Off,
// or an internal unlimited account) is not held to this.

export interface FreeTierContext {
  // The organization the work is for, when the caller knows it (a briefing, a group's session). Without it the coach is on the free tier only if EVERY organization they belong to is.
  organizationId?: string | null;
}

async function orgIsFree(db: any, orgId: string, now: Date): Promise<boolean> {
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
}

// The organizations a coach belongs to, oldest first.
async function orgsOf(db: any, coachId: string): Promise<string[]> {
  const { data } = await db.from("organization_memberships").select("organization_id").eq("profile_id", coachId).order("created_at", { ascending: true });
  return ((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id);
}

async function scopeOrgs(db: any, coachId: string, ctx?: FreeTierContext): Promise<string[]> {
  return ctx?.organizationId ? [ctx.organizationId] : orgsOf(db, coachId);
}

// Whether the coach is on the free tier for this work. With the organization known it is that organization's plan; without it, only a coach whose organizations are ALL free (a coach with one paying or
// founding organization is never cut off because another one is on the free plan). Any failure to find out means "not free tier".
export async function isFreeTierCoach(db: any, coachId: string, ctx?: FreeTierContext, now: Date = new Date()): Promise<boolean> {
  if (!isBillingEnforced()) return false;
  try {
    const orgs = await scopeOrgs(db, coachId, ctx);
    if (orgs.length === 0) return false;
    for (const orgId of orgs) if (!(await orgIsFree(db, orgId, now))) return false;
    return true;
  } catch {
    return false;
  }
}

// A free-tier coach who pays for AI is not held to it: an internal/unlimited account, an active Lift Off subscription, AI credits, or an AI top-up balance.
export async function hasPaidAiBalance(db: any, coachId: string): Promise<boolean> {
  try {
    const [{ data: credits }, { data: liftOff }, status] = await Promise.all([
      db.from("coach_credits").select("balance, ai_access_mode").eq("coach_id", coachId).maybeSingle(),
      db.from("lift_off_subscriptions").select("status").eq("coach_id", coachId).eq("status", "active").maybeSingle(),
      getCoachBudgetStatus(db, coachId),
    ]);
    return credits?.ai_access_mode === "unlimited" || !!liftOff || (credits?.balance ?? 0) > 0 || (status?.balanceUsd ?? 0) > 0;
  } catch {
    return false;
  }
}

// True when this coach gets NO AI at all outside their monthly free uses (free tier, nothing paid). The scheduled AI jobs skip such a coach before doing any work.
export async function isZeroAiCoach(db: any, coachId: string, ctx?: FreeTierContext): Promise<boolean> {
  return (await isFreeTierCoach(db, coachId, ctx)) && !(await hasPaidAiBalance(db, coachId));
}

const monthStart = (): string => `${currentAllowancePeriod()}T00:00:00Z`;

const USE_FEATURES = Object.values(FREE_TIER_USE_FEATURE);

// The people whose free uses are pooled with this coach's: everyone in the organization(s) in scope (a free organization has ONE allowance, not one per trainer).
async function pool(db: any, coachId: string, ctx?: FreeTierContext): Promise<string[]> {
  const ids = new Set<string>([coachId]);
  const orgs = await scopeOrgs(db, coachId, ctx);
  for (const orgId of orgs) {
    const { data } = await db.from("organization_memberships").select("profile_id").eq("organization_id", orgId).limit(500);
    for (const r of (data ?? []) as { profile_id: string }[]) ids.add(r.profile_id);
  }
  return [...ids];
}

// This month's big uses (every attempt counts: a failed or cut-off one too), oldest first. Null when it could not be read.
// The ids go to the database 100 at a time (a long list in one request can be too long to send), and the answers are put back in order.
async function usesThisMonth(db: any, ids: string[]): Promise<{ id: string; created_at: string }[] | null> {
  const byId = new Map<string, { id: string; created_at: string }>();
  for (const part of chunk(ids, 100)) {
    const { data, error } = await db.from("ai_usage_log").select("id, created_at").in("coach_id", part).in("feature", USE_FEATURES).gte("created_at", monthStart()).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(200);
    if (error) return null;
    for (const r of (data ?? []) as { id: string; created_at: string }[]) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
}

export async function freeTierUsesThisMonth(db: any, coachId: string, ctx?: FreeTierContext): Promise<number | null> {
  const rows = await usesThisMonth(db, await pool(db, coachId, ctx));
  return rows ? rows.length : null;
}

// Takes one of the free uses for a big action, before the action runs. Not on the free tier (or paying): nothing is taken and it is allowed. The row is written first and then its place in this month's order is
// read: the first FREE_TIER_AI_USES rows win, in the order they were written, so two requests at once are settled by that order (exactly one gets the last use) and a refused one gives its own row back.
export async function takeFreeTierUse(
  db: any,
  coachId: string,
  kind: FreeTierUseKind,
  ctx?: FreeTierContext
): Promise<{ ok: true; free: boolean; used?: number } | { ok: false; error: string }> {
  if (!(await isFreeTierCoach(db, coachId, ctx))) return { ok: true, free: false };
  if (await hasPaidAiBalance(db, coachId)) return { ok: true, free: false };
  const unavailable = { ok: false as const, error: "AI is briefly unavailable. Try again in a moment." };
  const ids = await pool(db, coachId, ctx);
  const before = await usesThisMonth(db, ids);
  if (before == null) return unavailable;
  if (before.length >= FREE_TIER_AI_USES) return { ok: false, error: freeTierOutMessage() };
  const { data: inserted, error } = await db
    .from("ai_usage_log")
    .insert({ user_id: coachId, coach_id: coachId, feature: FREE_TIER_USE_FEATURE[kind], status: "ok", completed_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  if (error || !inserted?.id) return unavailable;
  const after = await usesThisMonth(db, ids);
  if (after == null) {
    await giveBack(db, inserted.id);
    return unavailable;
  }
  const place = after.findIndex((r) => r.id === inserted.id);
  if (place < 0 || place >= FREE_TIER_AI_USES) {
    await giveBack(db, inserted.id);
    return { ok: false, error: freeTierOutMessage() };
  }
  return { ok: true, free: true, used: place + 1 };
}

async function giveBack(db: any, id: string): Promise<void> {
  // A row that cannot be removed would count against a use that was refused, so it is tried again once and then reported.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await db.from("ai_usage_log").delete().eq("id", id);
    if (!error) return;
  }
  console.error("[free-tier] could not give back a refused use:", id);
}

// For an AI route: the 402 to return when the coach has no free use left, or null to go ahead.
export async function freeTierUseOrRefuse(coachId: string, kind: FreeTierUseKind, ctx?: FreeTierContext): Promise<NextResponse | null> {
  const result = await takeFreeTierUse(createServiceRoleClient(), coachId, kind, ctx);
  return result.ok ? null : NextResponse.json({ error: result.error }, { status: 402 });
}

export interface FreeTierMeter {
  freeTier: boolean;
  used: number;
  limit: number;
  left: number;
}

// What the "3 of 5 AI uses left this month" line shows. freeTier false = show nothing (the normal AI meter applies).
export async function freeTierMeter(db: any, coachId: string, ctx?: FreeTierContext): Promise<FreeTierMeter> {
  const none: FreeTierMeter = { freeTier: false, used: 0, limit: FREE_TIER_AI_USES, left: FREE_TIER_AI_USES };
  if (!(await isFreeTierCoach(db, coachId, ctx))) return none;
  if (await hasPaidAiBalance(db, coachId)) return none;
  const used = (await freeTierUsesThisMonth(db, coachId, ctx)) ?? 0;
  return { freeTier: true, used, limit: FREE_TIER_AI_USES, left: Math.max(0, FREE_TIER_AI_USES - used) };
}
