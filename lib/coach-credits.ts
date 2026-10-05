import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_ALLOWANCE_PER_STEP,
  allowanceLimit,
  type AllowanceScaleInput,
  allowanceUsed,
  clientSteps,
  nextAllowanceReset,
  type AllowanceAction,
} from "@/lib/ai-usage";

// credit_topup_low_tier_monetization_idea.md — locked pricing. $5 buys
// 5 credits ($1/credit). "Lift Off" is a separate $5/mo recurring-only
// bundle granting this many credits every cycle (1 program + 2
// nutrition plans + 1 CI overview, priced at the per-action costs below).
export const CREDIT_PACK_PRICE_CENTS = 500;
export const CREDIT_PACK_CREDITS = 5;
export const LIFT_OFF_PRICE_CENTS = 500;
// Kept literal to the original promise: 1 program (3) + 2 nutrition
// plans (3 each = 6) + 1 CI overview (2) = 11. Ron's own direct call
// 2026-09-30 — bumped from 9 once the nutrition-plan price itself
// changed from 2 to 3, rather than letting the bundle quietly under-
// deliver against its own stated components.
export const LIFT_OFF_MONTHLY_CREDITS = 11;

export const AI_ACTION_COSTS = {
  program_generation: 3,
  // Charged once for the whole plan (every meal slot in the current
  // view), not per meal — Ron's own direct correction 2026-09-30,
  // updating the original memory's "2 credits" figure.
  nutrition_plan: 3,
  // Defined for Lift Off's bundle accounting only — deliberately never
  // gated. The Collective Intelligence overview has no manual "run it
  // now" trigger and Ron confirmed (2026-09-30) it should stay that
  // way permanently: it already runs automatically every night for
  // everyone, so there's no real coach-initiated action to charge for.
  ci_overview: 2,
} as const;
export type AiActionKey = keyof typeof AI_ACTION_COSTS;

export interface CoachCreditCheck {
  ok: boolean;
  balance: number;
  unlimited: boolean;
  error?: string;
}

// Reads a coach's current credit standing without spending anything —
// used to show a balance in the UI before a coach commits to an action.
export async function getCoachCreditStanding(
  supabase: SupabaseClient,
  coachId: string
): Promise<{ balance: number; unlimited: boolean }> {
  const { data } = await supabase
    .from("coach_credits")
    .select("balance, ai_access_mode")
    .eq("coach_id", coachId)
    .maybeSingle();
  return {
    balance: data?.balance ?? 0,
    unlimited: data?.ai_access_mode === "unlimited",
  };
}

// What a coach has used of this month's included generations (the plan
// includes AI per 100-client step — see lib/ai-usage.ts), for the usage
// meter and the fail-fast pre-check. "Clients" matches coach_client_steps()
// in migration 0227: distinct training-membership athletes across every
// group this person coaches.
export interface AiUsageSummary {
  unlimited: boolean;
  balance: number;
  clients: number;
  steps: number;
  program: { used: number; limit: number };
  mealplan: { used: number; limit: number };
  resetsOn: string; // YYYY-MM-DD, first of next month UTC
}

// The coach's org billing state as it affects AI limits: a free-access (beta) org gets a smaller allowance, and the
// platform admin can set an org's own scale (organization_billing.ai_allowance_scale, migration 0250). Read under the
// coach's own session. If the scale column is not there yet this falls back to just the exempt flag.
async function readAllowanceScale(supabase: SupabaseClient, coachId: string): Promise<AllowanceScaleInput> {
  const { data: memberships } = await supabase.from("organization_memberships").select("organization_id").eq("profile_id", coachId);
  const orgIds = (memberships ?? []).map((m) => m.organization_id as string);
  if (orgIds.length === 0) return {};
  type BillingRow = { billing_exempt: boolean | null; ai_allowance_scale?: number | null };
  let rows: BillingRow[] = [];
  const full = await supabase.from("organization_billing").select("billing_exempt, ai_allowance_scale").in("organization_id", orgIds);
  if (!full.error) {
    rows = (full.data as BillingRow[] | null) ?? [];
  } else {
    const basic = await supabase.from("organization_billing").select("billing_exempt").in("organization_id", orgIds);
    rows = (basic.data as BillingRow[] | null) ?? [];
  }
  // Same pick as coach_ai_multiplier(): prefer an org that is not free-access.
  const sorted = [...rows].sort((a, b) => Number(!!a.billing_exempt) - Number(!!b.billing_exempt));
  const orgsWithoutRow = orgIds.length > rows.length;
  const pick = orgsWithoutRow ? { billing_exempt: false, ai_allowance_scale: null } : sorted[0];
  if (!pick) return {};
  return { exempt: !!pick.billing_exempt, scale: pick.ai_allowance_scale ?? null };
}

export async function getAiUsage(supabase: SupabaseClient, coachId: string): Promise<AiUsageSummary> {
  const [{ data: row }, { data: coachedRows }] = await Promise.all([
    supabase
      .from("coach_credits")
      .select("balance, ai_access_mode, allowance_period, program_used, mealplan_used")
      .eq("coach_id", coachId)
      .maybeSingle(),
    supabase.from("group_memberships").select("group_id").eq("profile_id", coachId).eq("role", "coach"),
  ]);
  const scaleOpts = await readAllowanceScale(supabase, coachId);
  const groupIds = (coachedRows ?? []).map((r) => r.group_id as string);
  let clients = 0;
  if (groupIds.length > 0) {
    const { data: athleteRows } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .in("group_id", groupIds)
      .eq("role", "athlete")
      .eq("membership_type", "training");
    clients = new Set((athleteRows ?? []).map((r) => r.profile_id as string)).size;
  }
  return {
    unlimited: row?.ai_access_mode === "unlimited",
    balance: row?.balance ?? 0,
    clients,
    steps: clientSteps(clients),
    program: {
      used: allowanceUsed("program_generation", row ?? null),
      limit: allowanceLimit("program_generation", clients, scaleOpts),
    },
    mealplan: {
      used: allowanceUsed("nutrition_plan", row ?? null),
      limit: allowanceLimit("nutrition_plan", clients, scaleOpts),
    },
    resetsOn: nextAllowanceReset(),
  };
}

// Fail-fast, read-only: can this coach run the action right now (included
// generations left, or credits to cover it, or unlimited)?
export async function canRunAiAction(
  supabase: SupabaseClient,
  coachId: string,
  action: AiActionKey
): Promise<{ ok: boolean; error?: string }> {
  const usage = await getAiUsage(supabase, coachId);
  if (usage.unlimited) return { ok: true };
  const cost = AI_ACTION_COSTS[action];
  if (action === "program_generation" && usage.program.used < usage.program.limit) return { ok: true };
  if (action === "nutrition_plan" && usage.mealplan.used < usage.mealplan.limit) return { ok: true };
  if (usage.balance >= cost) return { ok: true };
  return { ok: false, error: outOfAllowanceMessage(action, usage.balance) };
}

function outOfAllowanceMessage(action: AiActionKey, balance: number): string {
  const cost = AI_ACTION_COSTS[action];
  const what = action === "program_generation" ? "program generations" : "meal plans";
  if (action === "ci_overview") {
    return `This costs ${cost} credits — you have ${balance}. Buy more credits or get Lift Off to keep going.`;
  }
  return `You've used this month's included ${what}. Extra ones are ${cost} credits each — you have ${balance}. Buy more credits or get Lift Off to keep going.`;
}

// The real gate: call this from an authenticated AI-action route (the
// coach spending their OWN allowance/credits). coach_credits_race_
// condition_sept30.md — this used to do a plain SELECT read then a
// SEPARATE adjust_coach_credits RPC call, a real TOCTOU race. Now one
// atomic spend_ai_action() RPC (migration 0226/0227) uses this month's
// included generations first, then credits, all inside a single
// row-locked transaction — a genuinely concurrent second call blocks on
// the lock and sees the post-spend state. Returns ok:false with a
// coach-facing message and spends nothing when neither covers it.
export async function checkAndSpendCoachCredits(
  supabase: SupabaseClient,
  coachId: string,
  action: AiActionKey
): Promise<CoachCreditCheck> {
  const cost = AI_ACTION_COSTS[action];
  const allowancePerStep = action in AI_ALLOWANCE_PER_STEP ? AI_ALLOWANCE_PER_STEP[action as AllowanceAction] : 0;
  const { data, error } = await supabase.rpc("spend_ai_action", {
    p_coach_id: coachId,
    p_action: action,
    p_credit_cost: cost,
    p_allowance: allowancePerStep,
  });

  if (error) {
    return { ok: false, balance: 0, unlimited: false, error: "Couldn't process credits — try again." };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, balance: 0, unlimited: false, error: "Couldn't process credits — try again." };
  }

  if (row.unlimited) {
    return { ok: true, balance: row.new_balance, unlimited: true };
  }

  if (!row.spent) {
    return { ok: false, balance: row.new_balance, unlimited: false, error: outOfAllowanceMessage(action, row.new_balance) };
  }

  return { ok: true, balance: row.new_balance, unlimited: false };
}
