import type { SupabaseClient } from "@supabase/supabase-js";

// credit_topup_low_tier_monetization_idea.md — locked pricing. $5 buys
// 5 credits ($1/credit). "Lift Off" is a separate $5/mo recurring-only
// bundle granting this many credits every cycle (1 program + 2
// nutrition plans + 1 CI overview, priced at the per-action costs below).
export const CREDIT_PACK_PRICE_CENTS = 500;
export const CREDIT_PACK_CREDITS = 5;
export const LIFT_OFF_PRICE_CENTS = 500;
export const LIFT_OFF_MONTHLY_CREDITS = 9;

export const AI_ACTION_COSTS = {
  program_generation: 3,
  nutrition_plan: 2,
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

// The real gate: call this from an authenticated AI-action route (the
// coach spending their OWN credits — never pass a service-role client
// here, that's only for the webhook's grant path via adjust_coach_credits
// directly). Returns ok:false with a coach-facing message and spends
// nothing when the balance is insufficient; actually decrements the
// balance only when the action is allowed to proceed.
export async function checkAndSpendCoachCredits(
  supabase: SupabaseClient,
  coachId: string,
  action: AiActionKey
): Promise<CoachCreditCheck> {
  const cost = AI_ACTION_COSTS[action];
  const standing = await getCoachCreditStanding(supabase, coachId);

  if (standing.unlimited) {
    return { ok: true, balance: standing.balance, unlimited: true };
  }

  if (standing.balance < cost) {
    return {
      ok: false,
      balance: standing.balance,
      unlimited: false,
      error: `This costs ${cost} credits — you have ${standing.balance}. Buy more credits or get Lift Off to keep going.`,
    };
  }

  const { data: newBalance, error } = await supabase.rpc("adjust_coach_credits", {
    p_coach_id: coachId,
    p_delta: -cost,
  });
  if (error) {
    return { ok: false, balance: standing.balance, unlimited: false, error: "Couldn't process credits — try again." };
  }

  return { ok: true, balance: newBalance ?? standing.balance - cost, unlimited: false };
}
