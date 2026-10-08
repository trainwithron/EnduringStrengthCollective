import type { SupabaseClient } from "@supabase/supabase-js";
import { TOP_UP_PACKS, budgetStatus, coachBudgetMessage, orgBudgetUsd, totalCostUsd, type BudgetStatus, type ModelUsage, type TopUpInfo, type TopUpPack } from "@/lib/ai-budget";
import { nextAllowanceReset } from "@/lib/ai-usage";
import { supportEmail } from "@/lib/legal";
import { isStripeConfigured } from "@/lib/stripe";
import { sendPushToProfile } from "@/lib/send-push";

// Server-only half of the AI budget (pure money math and words are in lib/ai-budget.ts). The budget is ONE POOL PER ORGANIZATION: a solo coach's organization is just them; a gym's
// trainers and all their clients share it. Every function takes the SERVICE-ROLE client: the usage log and the helper functions are not readable from the app. If the budget cannot
// be worked out (the database does not have step 46 yet, or a read fails) these return null and the caller carries on: the per-feature counts and the burst limits still apply, so
// a missing budget never takes AI down. A failure that is NOT "step 46 is not there yet" is logged (once per organization per hour) so a broken budget shows in the logs.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function resetsOnText(now: Date = new Date()): string {
  const [, m, d] = nextAllowanceReset(now).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Whether a coach can really buy a top-up right now: payments on, and at least one top-up price configured. (A purchase adds to the budget through the payment webhook.)
export function aiTopUpPurchasable(): boolean {
  return purchasablePacks().length > 0;
}

// The packs that can really be bought right now: payments on AND that pack's price configured.
export function purchasablePacks(): TopUpPack[] {
  if (!isStripeConfigured()) return [];
  return TOP_UP_PACKS.filter((p) => !!(p.cents === 500 ? process.env.STRIPE_PRICE_AI_TOPUP_5 : process.env.STRIPE_PRICE_AI_TOPUP_10));
}

// Packs that would bring a used-up month back under budget (every purchasable pack counts while the coach is not used up yet).
export const liftingPacks = (packs: TopUpPack[], status?: BudgetStatus | null): TopUpPack[] => packs.filter((p) => !status || status.level !== "out" || p.addUsd > status.shortfallUsd);

// What the coach is told about top-ups right now. Pass the budget status so the packs named (and offered) are only ones that really lift the pause.
export function topUpInfo(now: Date = new Date(), status?: BudgetStatus | null): TopUpInfo {
  const purchasable = purchasablePacks();
  const packs = liftingPacks(purchasable, status);
  return { available: packs.length > 0, packs, wouldNotCover: purchasable.length > 0 && packs.length === 0, balanceUsd: status?.balanceUsd ?? 0, supportEmail: supportEmail(), resetsOn: resetsOnText(now) };
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

// The organization a coach's AI use is pooled in (their first organization membership; a coach belongs to one organization everywhere else in the app).
export async function resolveOrg(db: SupabaseClient, coachId: string): Promise<string | null> {
  const { data } = await db.from("organization_memberships").select("organization_id").eq("profile_id", coachId).order("created_at", { ascending: true }).limit(1);
  return (data?.[0]?.organization_id as string | undefined) ?? null;
}

// Start of the current UTC month as an ISO timestamp, and as a date.
export const monthStartIso = (now: Date = new Date()): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
export const monthStartDate = (now: Date = new Date()): string => monthStartIso(now).slice(0, 10);

const lastLogged = new Map<string, number>();
const LOG_EVERY_MS = 60 * 60 * 1000;
export function logBudgetProblem(orgId: string, what: string, message: string, now: number = Date.now()): boolean {
  const last = lastLogged.get(orgId);
  if (last != null && now - last < LOG_EVERY_MS) return false;
  lastLogged.set(orgId, now);
  console.error(`[ai-budget] could not work out the budget for organization ${orgId} (${what}): ${message}. AI continues under the per-feature limits.`);
  return true;
}
export const resetBudgetLogForTests = (): void => lastLogged.clear();

// "The database does not have the budget functions yet" (Release N not pasted): expected before the paste, not worth logging.
const isMissingFunction = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === "PGRST202" || error.code === "42883" || /ai_org_(summary|month_usage)/.test(error.message ?? ""));

export interface OrgBudgetStatus extends BudgetStatus {
  organizationId: string;
  // Everything the organization has ever bought in top-ups.
  topUpsUsd: number;
}

// The balance table (0305) is not in the database until its small paste: reading it then fails with "relation does not exist", which is expected and means no draws recorded yet.
const isMissingDrawsTable = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === "42P01" || error.code === "PGRST205" || /ai_topup_draws/.test(error.message ?? ""));

const round2 = (n: number): number => Math.round(n * 100) / 100;

// The organization's AI picture right now. Two pots, spent in this order: the INCLUDED monthly budget (resets on the 1st, use it or lose it), then the TOP-UP BALANCE (everything ever
// bought, minus what earlier months drew from it; it carries over with no expiry). The pause happens only when both are used up.
//
// What a month drew from the balance is the part of its AI cost beyond the included budget. Earlier months' draws are final and kept in ai_topup_draws, written here as the month's
// use passes the included budget; this month's draw is worked out live, so the balance is always: bought - earlier months' draws - this month's use beyond the included budget.
export async function getOrgBudgetStatus(db: SupabaseClient, orgId: string, now: Date = new Date()): Promise<OrgBudgetStatus | null> {
  try {
    const { data: summaryRows, error: summaryError } = await db.rpc("ai_org_summary", { p_org_id: orgId });
    if (summaryError || !summaryRows) {
      if (!isMissingFunction(summaryError)) logBudgetProblem(orgId, "summary", summaryError?.message ?? "no answer", now.getTime());
      return null;
    }
    const summary = (Array.isArray(summaryRows) ? summaryRows[0] : summaryRows) as { clients: number; coaches: number; billing_exempt: boolean; ai_scale: number | string | null; owner_unlimited: boolean } | undefined;
    if (!summary) return null;
    if (summary.owner_unlimited) return { ...budgetStatus(0, 0, true), organizationId: orgId, topUpsUsd: 0 };

    const month = monthStartDate(now);
    const [{ data: usage, error: usageError }, { data: topUps, error: topUpsError }, { data: draws, error: drawsError }] = await Promise.all([
      db.rpc("ai_org_month_usage", { p_org_id: orgId, p_since: monthStartIso(now) }),
      db.from("ai_budget_topups").select("usd_added").eq("organization_id", orgId),
      db.from("ai_topup_draws").select("month, usd_drawn").eq("organization_id", orgId),
    ]);
    if (usageError) {
      if (!isMissingFunction(usageError)) logBudgetProblem(orgId, "usage", usageError.message ?? "no answer", now.getTime());
      return null;
    }
    // If the balance cannot be read the budget is unknown (fail open), never a pause that ignores money the organization paid.
    if (topUpsError) {
      logBudgetProblem(orgId, "top-ups", topUpsError.message ?? "no answer", now.getTime());
      return null;
    }
    const drawsKnown = !drawsError;
    if (drawsError && !isMissingDrawsTable(drawsError)) logBudgetProblem(orgId, "top-up draws", drawsError.message ?? "no answer", now.getTime());
    const drawRows = drawsKnown ? ((draws ?? []) as { month: string; usd_drawn: number | string }[]) : [];

    const boughtUsd = ((topUps ?? []) as { usd_added: number | string }[]).reduce((sum, r) => sum + Number(r.usd_added), 0);
    const earlierDrawsUsd = drawRows.filter((d) => String(d.month).slice(0, 10) < month).reduce((sum, d) => sum + Number(d.usd_drawn), 0);
    const recordedThisMonth = Number(drawRows.find((d) => String(d.month).slice(0, 10) === month)?.usd_drawn ?? 0);
    const availableUsd = Math.max(0, boughtUsd - earlierDrawsUsd);

    const included = orgBudgetUsd({
      clients: Number(summary.clients),
      coaches: Number(summary.coaches),
      exempt: !!summary.billing_exempt,
      scale: summary.ai_scale == null ? null : Number(summary.ai_scale),
    });
    const spentUsd = totalCostUsd((usage ?? []) as ModelUsage[]);
    const status = budgetStatus(spentUsd, included, false, { availableUsd, everBought: boughtUsd > 0 });

    // Record this month's draw once it grows (it can only grow within a month), so next month starts from the right balance. Best effort: a failed write only means the next check redoes it.
    const drawNow = round2(Math.min(Math.max(0, spentUsd - included), availableUsd));
    if (drawsKnown && drawNow > recordedThisMonth + 0.004) {
      try {
        await db.from("ai_topup_draws").upsert({ organization_id: orgId, month, usd_drawn: drawNow, updated_at: now.toISOString() }, { onConflict: "organization_id,month" });
      } catch {
        // ignored on purpose
      }
    }
    return { ...status, organizationId: orgId, topUpsUsd: round2(boughtUsd) };
  } catch (e) {
    logBudgetProblem(orgId, "exception", e instanceof Error ? e.message : String(e), now.getTime());
    return null;
  }
}

// The budget status for the pool this coach belongs to.
export async function getCoachBudgetStatus(db: SupabaseClient, coachId: string, now: Date = new Date()): Promise<OrgBudgetStatus | null> {
  try {
    const orgId = await resolveOrg(db, coachId);
    if (!orgId) return null;
    return await getOrgBudgetStatus(db, orgId, now);
  } catch {
    return null;
  }
}

// Tells the organization ONCE per month and level (the record's primary key makes a repeat a no-op): the organization's owner and the coach whose use crossed the line, by push; the
// meter shows it when they open the app. Best effort: never throws.
export async function noteBudgetLevel(db: SupabaseClient, crossingCoachId: string, level: "low" | "out" | "balance", now: Date = new Date(), status?: BudgetStatus | null): Promise<boolean> {
  try {
    const orgId = await resolveOrg(db, crossingCoachId);
    if (!orgId) return false;
    const { data, error } = await db.from("ai_budget_notices").upsert({ organization_id: orgId, month: monthStartDate(now), level }, { onConflict: "organization_id,month,level", ignoreDuplicates: true }).select("level");
    if (error || !data || data.length === 0) return false;
    const { data: org } = await db.from("organizations").select("owner_id").eq("id", orgId).maybeSingle();
    const recipients = [...new Set([(org?.owner_id as string | undefined) ?? null, crossingCoachId].filter((x): x is string => !!x))];
    const title = level === "low" ? "Your AI is almost used up this month" : level === "balance" ? "You're now using your AI top-up balance" : "Your AI is used up this month";
    const body = coachBudgetMessage(level, topUpInfo(now, status));
    for (const to of recipients) await sendPushToProfile(db, to, title, body, "/dashboard");
    return true;
  } catch {
    return false;
  }
}
