import { CLIENT_STEP_SIZE, aiMultiplier, type AllowanceScaleInput } from "@/lib/ai-usage";
import { CREDIT_PACK_PRICE_CENTS } from "@/lib/coach-credits";

// The monthly AI budget: ONE number per coach, in real cost, for everything the AI does on their behalf (programs, meal plans and slots, Spot questions, the daily briefing,
// the spotters, imports, food photo and typed logging). Every AI call is logged with its model and token counts (ai_usage_log); this prices them and compares the month's total with
// the coach's budget. The per-feature counts and the per-minute burst limits in lib/ai-usage.ts stay as sub-limits against runaway use.

// ---- prices ----------------------------------------------------------------------------------------------------------------------------------------
// US dollars per million tokens, standard (not batch, no cache discount: the app uses neither). Checked against Anthropic's price list on 2026-10-08:
// https://platform.claude.com/docs/en/about-claude/pricing (Sonnet 5 and Sonnet 5.5 are $2 in / $10 out; the earlier "introductory" Sonnet 5 price is now the standard price).
// Keys are matched as the START of the model id, longest first, so a dated id such as "claude-sonnet-5-5-20261001" still finds its price.
export const PRICE_CHECKED_ON = "2026-10-08";
export const PRICE_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "claude-haiku-4": { inputPerMTok: 1, outputPerMTok: 5 },
};
// A model id the table does not know is priced at an Opus-class rate, so an unexpected model can only make the meter run ahead of the real bill, never behind it.
export const UNKNOWN_MODEL_PRICE: ModelPrice = { inputPerMTok: 5, outputPerMTok: 25 };

export function priceFor(model: string | null | undefined): ModelPrice {
  if (!model) return UNKNOWN_MODEL_PRICE;
  const id = model.toLowerCase();
  const key = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => id.startsWith(k));
  return key ? MODEL_PRICES[key] : UNKNOWN_MODEL_PRICE;
}

export function callCostUsd(model: string | null | undefined, inputTokens: number | null | undefined, outputTokens: number | null | undefined): number {
  const p = priceFor(model);
  return ((inputTokens ?? 0) * p.inputPerMTok + (outputTokens ?? 0) * p.outputPerMTok) / 1_000_000;
}

// One row of ai_month_usage(): a model's finished calls this month, summed.
export interface ModelUsage {
  model: string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  calls?: number | string | null;
}

export function totalCostUsd(rows: ModelUsage[]): number {
  return rows.reduce((sum, r) => sum + callCostUsd(r.model, Number(r.input_tokens ?? 0), Number(r.output_tokens ?? 0)), 0);
}

// ---- the budget ------------------------------------------------------------------------------------------------------------------------------------
// US dollars of AI per 100-client step per month. Change this one number to change every coach's budget. It is scaled exactly like the other AI limits (aiMultiplier): a coach
// with fewer than 25 clients gets a prorated share (never below a quarter), 100 clients = one step, 150 = two, and a free-access (beta) organization gets BETA_ALLOWANCE_SCALE
// of a step unless the platform admin sets its own scale.
export const AI_BUDGET_USD_PER_STEP = 25;
export { CLIENT_STEP_SIZE };

export function budgetUsd(clientCount: number, opts: AllowanceScaleInput = {}): number {
  return Math.round(AI_BUDGET_USD_PER_STEP * aiMultiplier(clientCount, opts) * 100) / 100;
}

// The same, from the multiplier the database already computes (coach_ai_multiplier, which mirrors aiMultiplier).
export const budgetFromMultiplier = (multiplier: number): number => Math.round(AI_BUDGET_USD_PER_STEP * multiplier * 100) / 100;

export const LOW_AT = 0.8;

export type BudgetLevel = "ok" | "low" | "out" | "unlimited";

export interface BudgetStatus {
  level: BudgetLevel;
  spentUsd: number;
  budgetUsd: number;
  // Whole percent of the budget used (can pass 100).
  pct: number;
  unlimited: boolean;
}

export function budgetStatus(spentUsd: number, budget: number, unlimited = false): BudgetStatus {
  if (unlimited) return { level: "unlimited", spentUsd, budgetUsd: budget, pct: 0, unlimited: true };
  const ratio = budget > 0 ? spentUsd / budget : 1;
  const pct = Math.floor(ratio * 100 + 1e-9);
  return { level: ratio >= 1 ? "out" : ratio >= LOW_AT ? "low" : "ok", spentUsd, budgetUsd: budget, pct, unlimited: false };
}

// ---- words -----------------------------------------------------------------------------------------------------------------------------------------
export interface TopUpInfo {
  // True when buying more is possible right now (payments are switched on). While billing is off there is no buy button and the message says AI resumes on the 1st.
  available: boolean;
  supportEmail: string | null;
  resetsOn: string; // "November 1"
}

const money = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// The coach hears it plainly, in Ron's own voice. The top-up price is the existing top-up pack price (lib/coach-credits.ts), never a number made up here.
export function coachBudgetMessage(level: "low" | "out", top: TopUpInfo): string {
  const free = "Food search, barcode and saved meals stay free.";
  const business =
    "Every AI request costs real money, and I'm running a small business: if it keeps going past what's included I lose money, so extra AI use is a paid top-up.";
  const price = `Top-ups start at ${money(CREDIT_PACK_PRICE_CENTS)}.`;
  const help = top.supportEmail ? ` Questions: ${top.supportEmail}.` : "";
  if (level === "low") {
    return top.available
      ? `Heads up: your AI for this month is almost used up. ${business} ${price} ${free}`
      : `Heads up: your AI for this month is almost used up. ${business} Top-ups aren't open yet, so if it runs out, AI features pause until ${top.resetsOn}. ${free}${help}`;
  }
  return top.available
    ? `Your AI for this month is used up, so AI features are paused. ${business} ${price} ${free}`
    : `Your AI for this month is used up, so AI features are paused until ${top.resetsOn}. ${business} Top-ups aren't open yet. ${free}${help}`;
}

// What a CLIENT sees when their coach's AI is used up. Never the business explanation, and always the ways that still work.
export const CLIENT_AI_PAUSED_MESSAGE = "AI photo and typed logging is paused for this month. You can still search foods, scan a barcode or use your saved meals.";

// What a coach sees at the moment an AI feature they just tried is paused.
export function coachPausedMessage(top: TopUpInfo): string {
  return coachBudgetMessage("out", top);
}

// The error text when the budget is used up: the coach's own words for the coach (and for a nightly job, which only logs it), the friendly pause line for a client.
export function budgetOutMessage(actorIsCoach: boolean, top: TopUpInfo): string {
  return actorIsCoach ? coachPausedMessage(top) : CLIENT_AI_PAUSED_MESSAGE;
}

export const meterLine = (status: BudgetStatus): string => (status.unlimited ? "AI this month: no limit on your account." : `AI this month: ${Math.min(status.pct, 999)}% used`);

// Internal accounts (coach_credits.ai_access_mode = 'unlimited') have no budget.
export const isUnlimitedMode = (mode: string | null | undefined): boolean => mode === "unlimited";
