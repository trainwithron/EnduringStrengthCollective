import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetFromMultiplier, budgetStatus, coachBudgetMessage, isUnlimitedMode, totalCostUsd, type BudgetStatus, type ModelUsage, type TopUpInfo } from "@/lib/ai-budget";
import { nextAllowanceReset } from "@/lib/ai-usage";
import { supportEmail } from "@/lib/legal";
import { isStripeConfigured } from "@/lib/stripe";
import { sendPushToProfile } from "@/lib/send-push";

// Server-only half of the AI budget (pure money math and words are in lib/ai-budget.ts). Every function takes the SERVICE-ROLE client: the usage log and the helper functions
// are not readable from the app. If the budget cannot be worked out (the database does not have step 46 yet, or a read fails) these return null and the caller carries on: the
// per-feature counts and the burst limits still apply, so a missing budget never takes AI down.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function resetsOnText(now: Date = new Date()): string {
  const [, m, d] = nextAllowanceReset(now).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function topUpInfo(now: Date = new Date()): TopUpInfo {
  return { available: isStripeConfigured(), supportEmail: supportEmail(), resetsOn: resetsOnText(now) };
}

// The coach an AI call lands on: the coach themselves, or the first coach of any group the person is in (the same rule reserve_ai_call uses).
export async function resolveBillingCoach(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data: own } = await db.from("group_memberships").select("profile_id").eq("profile_id", userId).eq("role", "coach").limit(1);
  if ((own ?? []).length > 0) return userId;
  const { data: groups } = await db.from("group_memberships").select("group_id").eq("profile_id", userId);
  const ids = (groups ?? []).map((g) => g.group_id as string);
  if (ids.length === 0) return null;
  const { data: coaches } = await db.from("group_memberships").select("profile_id, joined_at").in("group_id", ids).eq("role", "coach").order("joined_at", { ascending: true }).limit(1);
  return (coaches?.[0]?.profile_id as string | undefined) ?? null;
}

// Start of the current UTC month as an ISO timestamp.
export const monthStartIso = (now: Date = new Date()): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export async function getCoachBudgetStatus(db: SupabaseClient, coachId: string, now: Date = new Date()): Promise<BudgetStatus | null> {
  try {
    const { data: credit } = await db.from("coach_credits").select("ai_access_mode").eq("coach_id", coachId).maybeSingle();
    if (isUnlimitedMode((credit as { ai_access_mode?: string } | null)?.ai_access_mode)) return budgetStatus(0, 0, true);
    const { data: mult, error: multError } = await db.rpc("coach_ai_multiplier", { p_coach_id: coachId });
    if (multError || mult == null) return null;
    const { data: usage, error: usageError } = await db.rpc("ai_month_usage", { p_coach_id: coachId, p_since: monthStartIso(now) });
    if (usageError) return null;
    return budgetStatus(totalCostUsd((usage ?? []) as ModelUsage[]), budgetFromMultiplier(Number(mult)));
  } catch {
    return null;
  }
}

// Tells the coach ONCE per month and level (the record's primary key makes a repeat a no-op), by push and, when they open the app, by the meter. Best effort: never throws.
export async function noteBudgetLevel(db: SupabaseClient, coachId: string, level: "low" | "out", now: Date = new Date()): Promise<boolean> {
  try {
    const month = monthStartIso(now).slice(0, 10);
    const { data, error } = await db.from("ai_budget_notices").upsert({ coach_id: coachId, month, level }, { onConflict: "coach_id,month,level", ignoreDuplicates: true }).select("level");
    if (error || !data || data.length === 0) return false;
    await sendPushToProfile(db, coachId, level === "low" ? "Your AI is almost used up this month" : "Your AI is used up this month", coachBudgetMessage(level, topUpInfo(now)), "/dashboard");
    return true;
  } catch {
    return false;
  }
}
