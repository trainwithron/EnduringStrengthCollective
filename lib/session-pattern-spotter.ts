// Session Pattern Spotter
// (habit_spotter_and_post_workout_coach_page_research_sept19.md) — 4
// deterministic, single-signal detectors over a client's real trailing
// session history, same governing rule as every Spotter in this app:
// pure detection, suggestive only, judged over a real multi-session
// window (never a single session in isolation — the research is
// explicit that an isolated reading is noisy, only a trend is real).
// Named "Session Pattern Spotter," not "Habit Spotter" — the research
// flagged that "habit" is already load-bearing elsewhere (the
// coach-set client_habits/missed_habits concept, a completely
// different thing), so this uses a name that doesn't collide.

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// --- Signal 1: RPE/effort creep -------------------------------------
// Session-RPE trending down across recent sessions vs. this client's
// own trailing baseline — real, established training-load-monitoring
// method. Judged as a rolling-window comparison, never one session.

export interface RpeCreepResult {
  recentAvgRpe: number;
  baselineAvgRpe: number;
  deltaDown: number;
}

const DEFAULT_ROLLING_WINDOW = 3;
const DEFAULT_MIN_RPE_DELTA = 1.0;

export function detectRpeCreep(
  sessionAvgRpes: number[], // oldest -> newest, one real avg-RPE per session (nulls already filtered by caller)
  rollingWindow: number = DEFAULT_ROLLING_WINDOW,
  minDeltaDown: number = DEFAULT_MIN_RPE_DELTA
): RpeCreepResult | null {
  if (sessionAvgRpes.length < rollingWindow * 2) return null;
  const recent = sessionAvgRpes.slice(-rollingWindow);
  const baseline = sessionAvgRpes.slice(-rollingWindow * 2, -rollingWindow);
  const recentAvgRpe = average(recent);
  const baselineAvgRpe = average(baseline);
  const deltaDown = baselineAvgRpe - recentAvgRpe;
  if (deltaDown < minDeltaDown) return null;
  return { recentAvgRpe, baselineAvgRpe, deltaDown };
}

// --- Signal 2: rest-time creep ---------------------------------------
// Real elapsed rest vs. the exercise's own prescribed rest, averaged
// across enough recent sets to be a real pattern. Two honest
// directions: consistently over-resting or consistently under-resting.

export interface RestComparisonSample {
  targetRestSeconds: number;
  actualRestSeconds: number;
}

export interface RestTimeCreepResult {
  direction: "over" | "under";
  avgTargetSeconds: number;
  avgActualSeconds: number;
  avgDeltaPct: number;
  sampleSize: number;
}

const DEFAULT_MIN_REST_SAMPLES = 8;
const DEFAULT_REST_THRESHOLD_PCT = 30;

export function detectRestTimeCreep(
  samples: RestComparisonSample[],
  minSamples: number = DEFAULT_MIN_REST_SAMPLES,
  thresholdPct: number = DEFAULT_REST_THRESHOLD_PCT
): RestTimeCreepResult | null {
  if (samples.length < minSamples) return null;
  const avgTargetSeconds = average(samples.map((s) => s.targetRestSeconds));
  const avgActualSeconds = average(samples.map((s) => s.actualRestSeconds));
  if (avgTargetSeconds === 0) return null;
  const avgDeltaPct = (Math.abs(avgActualSeconds - avgTargetSeconds) / avgTargetSeconds) * 100;
  if (avgDeltaPct < thresholdPct) return null;
  return {
    direction: avgActualSeconds > avgTargetSeconds ? "over" : "under",
    avgTargetSeconds,
    avgActualSeconds,
    avgDeltaPct,
    sampleSize: samples.length,
  };
}

// --- Signal 3: warm-up skipping / a consistent struggle point --------
// A specific slot position (not a named exercise — a client swaps
// exercises, the SLOT itself is the pattern) that reliably gets fewer
// completed sets than prescribed, across enough real sessions.

export interface SlotCompletionSample {
  slotIndex: number;
  setsCompleted: number;
  setsPrescribed: number;
}

export interface StrugglePointResult {
  slotIndex: number;
  avgCompletionPct: number;
  sampleSize: number;
}

const DEFAULT_MIN_SLOT_SAMPLES = 5;
const DEFAULT_COMPLETION_THRESHOLD_PCT = 70;

export function detectStrugglePoint(
  samples: SlotCompletionSample[],
  minSamples: number = DEFAULT_MIN_SLOT_SAMPLES,
  completionThresholdPct: number = DEFAULT_COMPLETION_THRESHOLD_PCT
): StrugglePointResult | null {
  const bySlot = new Map<number, SlotCompletionSample[]>();
  for (const s of samples) {
    if (s.setsPrescribed <= 0) continue;
    const list = bySlot.get(s.slotIndex) ?? [];
    list.push(s);
    bySlot.set(s.slotIndex, list);
  }

  let worst: StrugglePointResult | null = null;
  for (const [slotIndex, slotSamples] of bySlot) {
    if (slotSamples.length < minSamples) continue;
    const avgCompletionPct =
      average(slotSamples.map((s) => (s.setsCompleted / s.setsPrescribed) * 100));
    if (avgCompletionPct >= completionThresholdPct) continue;
    if (!worst || avgCompletionPct < worst.avgCompletionPct) {
      worst = { slotIndex, avgCompletionPct, sampleSize: slotSamples.length };
    }
  }
  return worst;
}

// --- Signal 4: day-of-week rushing pattern ---------------------------
// One specific weekday consistently compressed (shorter real duration)
// relative to this same client's own overall average — never compared
// against another client, always against their own baseline.

export interface WeekdaySessionSample {
  weekday: number; // 0-6, Date.getDay()
  durationSeconds: number;
}

export interface WeekdayRushingResult {
  weekday: number;
  avgDurationSeconds: number;
  overallAvgDurationSeconds: number;
  deltaPct: number;
}

const DEFAULT_MIN_SAMPLES_PER_WEEKDAY = 3;
const DEFAULT_RUSHING_THRESHOLD_PCT = 25;

export function detectWeekdayRushing(
  samples: WeekdaySessionSample[],
  minSamplesPerWeekday: number = DEFAULT_MIN_SAMPLES_PER_WEEKDAY,
  thresholdPct: number = DEFAULT_RUSHING_THRESHOLD_PCT
): WeekdayRushingResult | null {
  const distinctWeekdays = new Set(samples.map((s) => s.weekday));
  if (distinctWeekdays.size < 2) return null; // nothing to compare a day against

  const overallAvgDurationSeconds = average(samples.map((s) => s.durationSeconds));
  if (overallAvgDurationSeconds === 0) return null;

  const byWeekday = new Map<number, number[]>();
  for (const s of samples) {
    const list = byWeekday.get(s.weekday) ?? [];
    list.push(s.durationSeconds);
    byWeekday.set(s.weekday, list);
  }

  let worst: WeekdayRushingResult | null = null;
  for (const [weekday, durations] of byWeekday) {
    if (durations.length < minSamplesPerWeekday) continue;
    const avgDurationSeconds = average(durations);
    const deltaPct = ((overallAvgDurationSeconds - avgDurationSeconds) / overallAvgDurationSeconds) * 100;
    if (deltaPct < thresholdPct) continue; // only a real, meaningful SHORTFALL counts as "rushing"
    if (!worst || deltaPct > worst.deltaPct) {
      worst = { weekday, avgDurationSeconds, overallAvgDurationSeconds, deltaPct };
    }
  }
  return worst;
}
