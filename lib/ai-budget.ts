import { BETA_ALLOWANCE_SCALE, CLIENT_STEP_SIZE, aiMultiplier, type AllowanceScaleInput } from "@/lib/ai-usage";

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
// US dollars of AI per 100-client step per month, for the whole ORGANIZATION: a solo coach's organization is just them; a gym with several trainers shares one pool. Change these
// numbers to change every budget. It is scaled exactly like the other AI limits (aiMultiplier): an organization with fewer than 25 clients gets a prorated share (never below a
// quarter), 100 clients = one step, 150 = two. Each coach beyond the first adds a little (they are real people using it). A free-access (beta) organization gets BETA_ALLOWANCE_SCALE of
// all that unless the platform admin sets the organization's own scale (Admin > Organizations). The included budget resets every calendar month (use it or lose it, so the cost stays
// bounded). Paid top-up packs (TOP_UP_PACKS) are different: they go into a BALANCE that is spent only after the month's included budget is used up, and whatever is left carries over to the
// next month, with no expiry.
export const AI_BUDGET_USD_PER_STEP = 25;
export const AI_BUDGET_USD_PER_EXTRA_COACH = 5;
export { CLIENT_STEP_SIZE };

// A top-up pack: what the coach pays and the dollars of AI it adds to the organization's top-up BALANCE. Priced so a pack is profitable after Stripe's fees: $5 buys $3.50 of AI,
// $10 buys $7. The balance carries over from month to month until it is used.
export interface TopUpPack {
  cents: number;
  addUsd: number;
}
export const TOP_UP_PACKS: TopUpPack[] = [
  { cents: 500, addUsd: 3.5 },
  { cents: 1000, addUsd: 7 },
];
export const packFor = (cents: number): TopUpPack | null => TOP_UP_PACKS.find((p) => p.cents === cents) ?? null;

export interface OrgBudgetInput {
  clients: number;
  coaches: number;
  exempt?: boolean;
  scale?: number | null;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;

// The organization's INCLUDED budget for the month: steps by total clients, plus a little for each coach beyond the first, both scaled for a free-access or specially-scaled
// organization. Paid top-ups are not part of it (they are a separate balance that carries over).
export function orgBudgetUsd(input: OrgBudgetInput): number {
  const opts: AllowanceScaleInput = { exempt: input.exempt, scale: input.scale };
  const steps = AI_BUDGET_USD_PER_STEP * aiMultiplier(input.clients, opts);
  const factor = input.scale != null ? input.scale : input.exempt ? BETA_ALLOWANCE_SCALE : 1;
  const extras = AI_BUDGET_USD_PER_EXTRA_COACH * Math.max(0, input.coaches - 1) * factor;
  return roundCents(steps + extras);
}

// A solo coach with no top-ups (the common case), for the simple callers and tests.
export function budgetUsd(clientCount: number, opts: AllowanceScaleInput = {}): number {
  return orgBudgetUsd({ clients: clientCount, coaches: 1, exempt: opts.exempt, scale: opts.scale });
}

export const LOW_AT = 0.8;

// ok = under 80 percent of the included budget; low = 80 percent or more of it; balance = the included budget is used up and the top-up balance is paying; out = both are used up.
export type BudgetLevel = "ok" | "low" | "balance" | "out" | "unlimited";

export interface BudgetStatus {
  level: BudgetLevel;
  // This month's AI cost so far, and the INCLUDED budget it is measured against.
  spentUsd: number;
  budgetUsd: number;
  // Whole percent of the included budget used (can pass 100).
  pct: number;
  unlimited: boolean;
  // The top-up balance left after this month's use beyond the included budget (carries over).
  balanceUsd: number;
  // How far this month's use beyond the included budget is past the whole top-up balance (0 unless out): a pack must add more than this to lift the pause.
  shortfallUsd: number;
  // Everything ever bought and not yet used up by earlier months, before this month's draw (so the meter can show a balance line even when it is $0.00 now).
  hasTopUps: boolean;
}

// `topUps.availableUsd` is the balance carried into this month plus anything bought this month (before this month's use beyond the included budget is taken from it).
export function budgetStatus(spentUsd: number, budget: number, unlimited = false, topUps: { availableUsd: number; everBought?: boolean } = { availableUsd: 0 }): BudgetStatus {
  if (unlimited) return { level: "unlimited", spentUsd, budgetUsd: budget, pct: 0, unlimited: true, balanceUsd: 0, shortfallUsd: 0, hasTopUps: false };
  const ratio = budget > 0 ? spentUsd / budget : 1;
  const pct = Math.floor(ratio * 100 + 1e-9);
  const over = Math.max(0, spentUsd - budget);
  const available = Math.max(0, topUps.availableUsd);
  const balanceUsd = roundCents(Math.max(0, available - over));
  const shortfallUsd = roundCents(Math.max(0, over - available));
  const level: BudgetLevel = ratio >= 1 ? (balanceUsd > 0 ? "balance" : "out") : ratio >= LOW_AT ? "low" : "ok";
  return { level, spentUsd, budgetUsd: budget, pct, unlimited: false, balanceUsd, shortfallUsd, hasTopUps: topUps.everBought ?? available > 0 };
}

// ---- words -----------------------------------------------------------------------------------------------------------------------------------------
export interface TopUpInfo {
  // True only when a coach can really buy more right now: payments are switched on AND a purchase adds to the budget (it does, through the payment webhook). While billing is off
  // there is no buy option and the message says AI resumes on the 1st.
  available: boolean;
  // The packs that can really be bought right now AND would lift the pause (what the message names and the buttons offer). Empty when none can.
  packs: TopUpPack[];
  // A pack can be bought but none is big enough to cover this month's overspend: the message says so instead of pretending top-ups are not open.
  wouldNotCover: boolean;
  // The top-up balance left (carries over), for the messages.
  balanceUsd: number;
  supportEmail: string | null;
  resetsOn: string; // "November 1"
}

const money = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const usd = (n: number): string => `$${n.toFixed(Number.isInteger(n) ? 0 : 2)}`;

// "A $5 top-up adds $3.50 of AI that carries over until it's used; a $10 top-up adds $7."
export const topUpPackLine = (packs: TopUpPack[] = TOP_UP_PACKS): string =>
  packs.map((p, i) => `${i === 0 ? "A" : "a"} ${money(p.cents)} top-up adds ${usd(p.addUsd)} of AI${i === 0 ? " that carries over from month to month until it's used" : ""}`).join("; ") + ".";

export const balanceText = (n: number): string => `$${n.toFixed(2)}`;

// The coach hears it plainly, in Ron's own voice. A price is only ever mentioned when a purchase really lifts the pause (top.available); otherwise the message says what will happen
// and when, and never points at a button that does not exist. The included AI refreshes on the 1st; a top-up balance (when there is one) is spent after it and carries over.
export function coachBudgetMessage(level: "low" | "out" | "balance", top: TopUpInfo): string {
  const free = "Food search, barcode and saved meals stay free.";
  const help = top.supportEmail ? ` Questions: ${top.supportEmail}.` : "";
  const cost = "Every AI request costs real money, and I'm running a small business";
  if (level === "balance") {
    return `Your included AI for this month is used up, so you're now using your top-up balance: ${balanceText(top.balanceUsd)} left. It carries over from month to month, and your included AI refreshes on ${top.resetsOn}. ${top.available ? `${topUpPackLine(top.packs)} ` : ""}${free}`;
  }
  if (level === "out" && top.wouldNotCover) {
    return `Your AI for this month is used up, so AI features are paused. ${cost}. A top-up wouldn't cover this month's use; AI resumes on ${top.resetsOn}. ${free}${help}`;
  }
  if (level === "low") {
    if (top.balanceUsd > 0) {
      return `Heads up: your included AI for this month is almost used up. You also have ${balanceText(top.balanceUsd)} of top-up balance, which takes over when it runs out and carries over from month to month. ${free}`;
    }
    return top.available
      ? `Heads up: your AI for this month is almost used up. ${cost}: if it keeps going past what's included I lose money, so extra AI use is a paid top-up. ${topUpPackLine(top.packs)} ${free}`
      : `Heads up: your AI for this month is almost used up. ${cost}: AI use beyond what's included will become a paid top-up, which isn't open yet. If it runs out, AI features pause until ${top.resetsOn}. ${free}${help}`;
  }
  return top.available
    ? `Your AI for this month is used up, so AI features are paused. ${cost}: extra AI use is a paid top-up. ${topUpPackLine(top.packs)} ${free}`
    : `Your AI for this month is used up, so AI features are paused until ${top.resetsOn}. ${cost}: AI use beyond what's included will become a paid top-up, which isn't open yet. ${free}${help}`;
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

export const meterLine = (status: BudgetStatus): string => (status.unlimited ? "AI this month: no limit on your account." : `This month's included AI: ${Math.min(status.pct, 999)}% used`);

// The second line of the meter: the top-up balance that carries over. Null when there never was one (and for an unlimited account).
export const balanceLine = (status: BudgetStatus): string | null => (status.unlimited || (!status.hasTopUps && status.balanceUsd <= 0) ? null : `Top-up balance: ${balanceText(status.balanceUsd)}`);

// Internal accounts (coach_credits.ai_access_mode = 'unlimited') have no budget.
export const isUnlimitedMode = (mode: string | null | undefined): boolean => mode === "unlimited";
