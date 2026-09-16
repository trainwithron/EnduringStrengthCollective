import { isWithinTaperWindow, weeksUntilEvent, type EventWindow } from "./event-window";
import { DEFAULT_ADJUSTMENT_PCT, clampAdjustmentPct } from "./nutrition-checkin";

// Training-block-aware macro suggestions (training_block_aware_nutrition_
// and_dragdrop_meal_planner_sept16.md). Two separate rules, kept separate
// on purpose because their evidence tiers genuinely differ — never
// blended into one number. Both are pure, deterministic, and only ever
// return a SUGGESTION the coach applies by hand; nothing here writes to
// daily_macros (same "everything comes to the coach" v1 governance rule
// already locked in goal_date_aware_nutrition_and_programming_idea.md).
export interface MacroSuggestion {
  kind: "taper" | "volume";
  headline: string;
  rationale: string;
  // null = "no numeric change proposed for this field" — the callout
  // still renders, the Apply button just leaves that field alone.
  suggestedCalories: number | null;
  suggestedCarbsG: number | null;
}

// Rule 1 — taper/event window. STRONG evidence: the ACSM/AND/DC joint
// position statement's pre-event carbohydrate protocol (10-12 g/kg body
// weight in the final 36-48h before an event lasting >90 min), already
// cited and sourced in food_logging_market_research.md. The freeze half
// is the exact bug goal_date_aware_nutrition_and_programming_idea.md's
// own deep dive named — a naive expenditure-aware engine would auto-cut
// calories during a taper (volume falls 40-60%), exactly when it
// shouldn't. "Freeze" here means: hand the caller's baseline back
// unchanged as the explicit suggestion, so the coach sees "hold this,"
// not a lower number.
//
// Carb-load window is DAY-granularity (final 2 days = the protocol's
// 36-48h), not hour-precision — consistent with this app's existing
// date-only conventions (event-window.ts's own daysBetween), not a false
// claim of hour-level accuracy.
const TAPER_CARB_G_PER_KG_LOW = 10;
const TAPER_CARB_G_PER_KG_HIGH = 12;
const CARB_LOAD_WINDOW_DAYS = 2;
const CARB_LOAD_MIN_EVENT_MINUTES = 90;

function daysUntilEvent(window: EventWindow, today: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const eventDate = new Date(`${window.targetDate}T00:00:00`);
  return Math.round((startOfDay(eventDate) - startOfDay(today)) / 86400000);
}

export function taperAdjustedMacroSuggestion(params: {
  baseCalories: number | null;
  eventWindow: EventWindow;
  today: Date;
  taperWeeks: number;
  bodyWeightKg: number | null;
}): MacroSuggestion | null {
  const { baseCalories, eventWindow, today, taperWeeks, bodyWeightKg } = params;
  if (!isWithinTaperWindow(eventWindow, today, taperWeeks)) return null;

  const daysOut = daysUntilEvent(eventWindow, today);
  const isCarbLoadWindow =
    eventWindow.expectedDurationMinutes != null &&
    eventWindow.expectedDurationMinutes > CARB_LOAD_MIN_EVENT_MINUTES &&
    daysOut >= 0 &&
    daysOut <= CARB_LOAD_WINDOW_DAYS;

  // Midpoint of the protocol's 10-12 g/kg range — the form needs one
  // fillable number; the range itself is stated in the rationale.
  const suggestedCarbsG =
    isCarbLoadWindow && bodyWeightKg && bodyWeightKg > 0
      ? Math.round(bodyWeightKg * ((TAPER_CARB_G_PER_KG_LOW + TAPER_CARB_G_PER_KG_HIGH) / 2))
      : null;

  const weeksOut = weeksUntilEvent(eventWindow, today);
  const holdClause =
    "Training volume drops during a taper, but calories shouldn't follow it down — hold them where they've been.";

  if (isCarbLoadWindow) {
    return {
      kind: "taper",
      headline: `Event in ${daysOut} day${daysOut === 1 ? "" : "s"} — hold calories, bump carbs`,
      rationale: `${holdClause} For an event over ${CARB_LOAD_MIN_EVENT_MINUTES} minutes, carbs in the final 36–48 hours should rise to ${TAPER_CARB_G_PER_KG_LOW}–${TAPER_CARB_G_PER_KG_HIGH} g/kg body weight (ACSM/AND/DC joint position statement)${
        suggestedCarbsG == null ? " — log a body weight to get a specific number" : ""
      }.`,
      suggestedCalories: baseCalories,
      suggestedCarbsG,
    };
  }

  return {
    kind: "taper",
    headline: `Taper week (${weeksOut === 0 ? "event week" : `${weeksOut} wk out`}) — hold calories steady`,
    rationale: holdClause,
    suggestedCalories: baseCalories,
    suggestedCarbsG: null,
  };
}

// Rule 2 — volume-relative week. Direction is well-established sports-
// nutrition consensus (energy/carb intake tracks training load, ISSN/
// ACSM position-stand territory). MAGNITUDE is deliberately NOT a newly
// invented number: it reuses lib/nutrition-checkin.ts's own already-
// committed adjustment envelope (1-15%, default 5%) — the spec's explicit
// instruction, and flagged to Ron as "reused, not independently
// re-sourced for this specific case."
//
// TRIGGER threshold (30% either direction) is likewise a conservative
// interpretation, not a fresh citation: a real taper/deload drops volume
// 40-60% per the figure already cited in lib/event-window.ts, so 30% sits
// safely below "clearly a lighter/heavier week" territory. Stated
// honestly rather than dressed up as sourced.
const VOLUME_DEVIATION_THRESHOLD = 0.3;

export function volumeRelativeMacroSuggestion(params: {
  baseCalories: number | null;
  thisWeekVolume: number;
  trailingAvgVolume: number;
}): MacroSuggestion | null {
  const { baseCalories, thisWeekVolume, trailingAvgVolume } = params;
  if (baseCalories == null || baseCalories <= 0 || trailingAvgVolume <= 0) return null;

  const deviation = thisWeekVolume / trailingAvgVolume - 1;
  if (Math.abs(deviation) < VOLUME_DEVIATION_THRESHOLD) return null;

  const adjustmentPct = clampAdjustmentPct(DEFAULT_ADJUSTMENT_PCT);
  const isLighterWeek = deviation < 0;
  const factor = isLighterWeek ? 1 - adjustmentPct / 100 : 1 + adjustmentPct / 100;
  const pctChange = Math.round(Math.abs(deviation) * 100);

  return {
    kind: "volume",
    headline: isLighterWeek
      ? `This week's planned volume is ${pctChange}% below your last 4 weeks`
      : `This week's planned volume is ${pctChange}% above your last 4 weeks`,
    rationale: `${isLighterWeek ? "Lower" : "Higher"} training load this week vs. the trailing 4-week average — consider ${
      isLighterWeek ? "lowering" : "raising"
    } calories by ${adjustmentPct}%. That ${adjustmentPct}% is this app's existing check-in adjustment default, reused here rather than independently re-sourced for this specific case.`,
    suggestedCalories: Math.round(baseCalories * factor),
    suggestedCarbsG: null,
  };
}
