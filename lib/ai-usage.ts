// AI cost control (migration 0226). Every Claude call is logged (model +
// tokens + feature + who) so cost can be computed per coach, and every
// coach/athlete-triggered call is burst-limited. All the numbers a person
// might want to tune live in this one file.

export const AI_BURST_LIMIT_PER_MINUTE = 6;

// The plan includes AI per 100-client step (a coach with 100 clients
// legitimately generates about one program per client per month), so
// every number below is PER STEP and the real limit is the number times
// the coach's step count: 100 clients = 1 step, 150 = 2, 250 = 3.
// Calendar month, UTC. Past the allowance the existing credit top-up
// applies (credits, then the "buy credits" message) — not a hard wall.
// CLIENT_STEP_SIZE is mirrored by coach_client_steps() in migration 0227.
export const CLIENT_STEP_SIZE = 100;
export const AI_ALLOWANCE_PER_STEP = {
  program_generation: 100,
  nutrition_plan: 200,
} as const;
export type AllowanceAction = keyof typeof AI_ALLOWANCE_PER_STEP;

// Backstop for the per-meal route. "AI Suggest All" charges a plan once
// and then calls the (otherwise ungated) per-meal route once per slot, so
// that route needs its own cap or it can simply be called directly.
// 200 plans x ~6 meals, per step.
export const MEAL_SLOT_MONTHLY_CEILING_PER_STEP = 1200;

// Client-count steps: max(1, ceil(clients / 100)).
export function clientSteps(clientCount: number): number {
  return Math.max(1, Math.ceil(clientCount / CLIENT_STEP_SIZE));
}

// Free-access (beta) orgs get this share of the standard allowance unless the platform admin sets their own scale:
// 0.3 is about 30 program generations and 60 meal plans a month. Mirrors coach_ai_multiplier() in migration 0250.
export const BETA_ALLOWANCE_SCALE = 0.3;
// Under this many clients a coach gets a prorated share of one step (never below a quarter), so a coach with no
// clients yet can still build programs but not at full volume.
export const SMALL_COACH_CLIENTS = 25;

export interface AllowanceScaleInput {
  exempt?: boolean;
  scale?: number | null;
}

// The one number every AI limit is scaled by. Mirrors coach_ai_multiplier() in migration 0250.
export function aiMultiplier(clientCount: number, opts: AllowanceScaleInput = {}): number {
  if (opts.scale != null) return opts.scale;
  if (opts.exempt) return BETA_ALLOWANCE_SCALE;
  if (clientCount < SMALL_COACH_CLIENTS) return Math.max(0.25, clientCount / SMALL_COACH_CLIENTS);
  return clientSteps(clientCount);
}

export type AiFeature =
  // coach/athlete-triggered (burst-limited)
  | "program_generation"
  | "program_chat"
  | "program_import_photo"
  | "session_nl"
  | "recipe_parse"
  | "food_log_parse"
  | "food_photo_parse"
  | "meal_plan_slot"
  | "ci_chat_router"
  | "ci_chat_synthesis"
  | "video_checkin_summary"
  | "biomech_tag_suggest"
  // system/automatic (logged, never limited)
  | "session_pattern_check"
  | "coach_briefing"
  | "spotter_cornerstone"
  | "spotter_overarching"
  | "trivia_generate";

interface FeaturePolicy {
  enforce: boolean;
  burstLimit?: number; // overrides AI_BURST_LIMIT_PER_MINUTE and counts this feature alone
  monthlyCeiling?: number;
}

const POLICY: Record<AiFeature, FeaturePolicy> = {
  // A failed or cut-off generation is not charged, but every attempt is logged, so a monthly ceiling of 1.5x the
  // included generations (per step, scaled like the allowance) stops failed attempts from being unlimited free spend.
  program_generation: { enforce: true, monthlyCeiling: 150 },
  program_chat: { enforce: true },
  program_import_photo: { enforce: true },
  session_nl: { enforce: true },
  recipe_parse: { enforce: true },
  food_log_parse: { enforce: true },
  food_photo_parse: { enforce: true },
  // A normal "AI Suggest All" is one call per meal slot back to back, so
  // it can't share the 6/min bucket — its own looser burst plus the
  // monthly ceiling is what bounds it.
  meal_plan_slot: { enforce: true, burstLimit: 20, monthlyCeiling: MEAL_SLOT_MONTHLY_CEILING_PER_STEP },
  ci_chat_router: { enforce: true },
  ci_chat_synthesis: { enforce: true },
  video_checkin_summary: { enforce: true },
  biomech_tag_suggest: { enforce: true },
  session_pattern_check: { enforce: false },
  coach_briefing: { enforce: false },
  spotter_cornerstone: { enforce: false },
  spotter_overarching: { enforce: false },
  trivia_generate: { enforce: false },
};

export interface AiCallMeta {
  feature: AiFeature;
  userId?: string | null; // the actor (burst limits are per actor)
  coachId?: string | null; // billing coach; resolved server-side from userId when omitted
}

export class AiRateLimitedError extends Error {
  reason: "burst" | "monthly_ceiling" | "unavailable";
  constructor(reason: "burst" | "monthly_ceiling" | "unavailable") {
    super(
      reason === "burst"
        ? "You're sending AI requests too quickly — wait a minute and try again."
        : reason === "unavailable"
          ? "AI is briefly unavailable. Try again in a moment."
          : "You've reached this month's limit for this AI feature. It resets on the 1st of next month."
    );
    this.name = "AiRateLimitedError";
    this.reason = reason;
  }
}

// Which features share one burst bucket with `feature`.
export function burstBucketFor(feature: AiFeature): AiFeature[] {
  const policy = POLICY[feature];
  if (policy.burstLimit != null) return [feature];
  return (Object.keys(POLICY) as AiFeature[]).filter(
    (f) => POLICY[f].enforce && POLICY[f].burstLimit == null
  );
}

export function burstLimitFor(feature: AiFeature): number {
  return POLICY[feature].burstLimit ?? AI_BURST_LIMIT_PER_MINUTE;
}

export function isEnforced(feature: AiFeature): boolean {
  return POLICY[feature].enforce;
}

export function monthlyCeilingFor(feature: AiFeature): number | null {
  return POLICY[feature].monthlyCeiling ?? null;
}

// Start of the current calendar month, UTC, as a date key.
export function currentAllowancePeriod(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// Included generations for a coach's row at their current client count.
// A row from an earlier month has effectively reset (spend_ai_action
// zeroes it on next spend).
export function allowanceLimit(action: AllowanceAction, clientCount: number, opts: AllowanceScaleInput = {}): number {
  return Math.ceil(AI_ALLOWANCE_PER_STEP[action] * aiMultiplier(clientCount, opts));
}

export function allowanceUsed(
  action: AllowanceAction,
  row: { allowance_period: string | null; program_used: number | null; mealplan_used: number | null } | null,
  now: Date = new Date()
): number {
  if (!row || row.allowance_period !== currentAllowancePeriod(now)) return 0;
  return action === "program_generation" ? row.program_used ?? 0 : row.mealplan_used ?? 0;
}

export function allowanceRemaining(
  action: AllowanceAction,
  row: { allowance_period: string | null; program_used: number | null; mealplan_used: number | null } | null,
  clientCount: number,
  now: Date = new Date(),
  opts: AllowanceScaleInput = {}
): number {
  return Math.max(0, allowanceLimit(action, clientCount, opts) - allowanceUsed(action, row, now));
}

// First day of next month, UTC, as a date key — when the allowance resets.
export function nextAllowanceReset(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
