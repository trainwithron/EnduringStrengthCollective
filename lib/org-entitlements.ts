// What an organization is entitled to, derived from its billing row. Pure
// (no DB, no env reads except isBillingEnforced) so every rule is testable.
//
// Nothing enforces this yet: until COACH_BILLING_ENFORCED=true, the
// EFFECTIVE access is always full with every add-on feature on. The RAW
// values are still computed so the Plan & Billing tab can show what would
// happen once enforcement is switched on.

import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/coach-plan-pricing";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export interface OrgBillingRow {
  billingExempt: boolean;
  trialEndsAt: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  orgAddon: boolean;
  orgAddonUntil: string | null;
  pastDueSince: string | null;
}

// full   = everything works
// grace  = everything works, with a "fix your plan" banner (GRACE_DAYS)
// locked = coach side goes to the billing page; athletes are never locked (nothing locks any more: an ended trial, a lapsed plan and a payment unpaid past its grace are all the free tier)
export type AccessLevel = "full" | "grace" | "locked";

export type PlanState =
  | "exempt"
  | "trial"
  | "trial_expired"
  | "active"
  | "past_due"
  | "canceled"
  | "lapsed";

export interface OrgEntitlements {
  enforced: boolean;
  state: PlanState;
  exempt: boolean;
  // What the org really qualifies for, regardless of the enforcement flag.
  rawAccessLevel: AccessLevel;
  rawOrgAddon: boolean;
  // What the app should act on: always full/true until enforcement is on.
  accessLevel: AccessLevel;
  orgAddon: boolean;
  // The free tier (Ron, Oct 17): up to FREE_TIER_CLIENT_LIMIT clients and FREE_TIER_AI_USES big AI uses a month, no AI crons. A coach whose trial ended without a subscription lands here (nothing is deleted;
  // athletes are never locked). Raw = what the organization qualifies for; effective = only once billing is enforced (until then every organization behaves as it always has).
  rawFreeTier: boolean;
  freeTier: boolean;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  graceEndsAt: Date | null;
  graceDaysLeft: number | null;
}

export function isBillingEnforced(): boolean {
  return process.env.COACH_BILLING_ENFORCED === "true";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysLeft(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

export function trialEndsAtFor(row: OrgBillingRow | null, orgCreatedAt: Date): Date {
  return row?.trialEndsAt ? new Date(row.trialEndsAt) : addDays(orgCreatedAt, TRIAL_DAYS);
}

function addonStillOn(row: OrgBillingRow, now: Date): boolean {
  if (row.orgAddon) return true;
  return !!row.orgAddonUntil && new Date(row.orgAddonUntil) > now;
}

export function deriveOrgEntitlements(
  row: OrgBillingRow | null,
  orgCreatedAt: Date,
  now: Date,
  enforced: boolean
): OrgEntitlements {
  const base = {
    enforced,
    trialEndsAt: null as Date | null,
    trialDaysLeft: null as number | null,
    graceEndsAt: null as Date | null,
    graceDaysLeft: null as number | null,
  };

  let state: PlanState;
  let rawAccessLevel: AccessLevel;
  let rawOrgAddon: boolean;
  let pastDueFree = false;
  const out = { ...base };

  const status = row?.subscriptionStatus ?? null;
  const hasSubscription = status !== null && status !== "incomplete";

  if (row?.billingExempt) {
    state = "exempt";
    rawAccessLevel = "full";
    rawOrgAddon = true;
  } else if (hasSubscription && (status === "active" || status === "trialing")) {
    state = "active";
    rawAccessLevel = "full";
    rawOrgAddon = addonStillOn(row!, now);
  } else if (hasSubscription && status === "past_due") {
    state = "past_due";
    const since = row!.pastDueSince ? new Date(row!.pastDueSince) : now;
    out.graceEndsAt = addDays(since, GRACE_DAYS);
    out.graceDaysLeft = daysLeft(out.graceEndsAt, now);
    const inGrace = now < out.graceEndsAt;
    // A payment that stays unpaid past its grace drops to the free tier like everything else that is not paid: nothing is locked.
    rawAccessLevel = inGrace ? "grace" : "full";
    rawOrgAddon = inGrace ? addonStillOn(row!, now) : false;
    pastDueFree = !inGrace;
  } else if (hasSubscription) {
    // canceled / unpaid / paused / incomplete_expired
    const paidThrough = row!.currentPeriodEnd ? new Date(row!.currentPeriodEnd) : null;
    if (status === "canceled" && paidThrough && paidThrough > now) {
      state = "canceled";
      rawAccessLevel = "full";
      rawOrgAddon = addonStillOn(row!, now);
    } else {
      // A lapsed plan drops to the free tier, like an ended trial: nothing is locked and nothing is deleted.
      state = "lapsed";
      rawAccessLevel = "full";
      rawOrgAddon = false;
    }
  } else {
    // No subscription yet: the free trial (everything included). When it ends the coach drops straight to the free tier: no grace period and no lock, nothing is deleted.
    const trialEnd = trialEndsAtFor(row, orgCreatedAt);
    out.trialEndsAt = trialEnd;
    out.trialDaysLeft = daysLeft(trialEnd, now);
    if (now < trialEnd) {
      state = "trial";
      rawAccessLevel = "full";
      rawOrgAddon = true;
    } else {
      state = "trial_expired";
      rawAccessLevel = "full";
      rawOrgAddon = false;
    }
  }

  // Past the trial with no paid plan (or a plan that lapsed): the free tier.
  const rawFreeTier = state === "trial_expired" || state === "lapsed" || pastDueFree;

  return {
    ...out,
    state,
    exempt: state === "exempt",
    rawAccessLevel,
    rawOrgAddon,
    rawFreeTier,
    freeTier: enforced && rawFreeTier,
    accessLevel: enforced ? rawAccessLevel : "full",
    orgAddon: enforced ? rawOrgAddon : true,
  };
}
