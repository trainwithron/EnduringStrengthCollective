// Programming Spotter (programming_spotter_program_review_idea.md) —
// reviews a program's own STRUCTURE before anyone logs a rep against it.
// Deliberately zero AI, zero synthesis call — same "Deliberately zero AI,
// zero new schema" architecture as lib/matched-load-trend.ts (Slice 1 of
// the AI Assistant), just pointed at program structure instead of set
// logs. Every check here is a pure function over already-computed data;
// suppression (dismissal memory, program-name matching) lives one layer
// up in the gather/route code, matching that same precedent.
//
// Deliberately NOT shipped, per the deep-dive's own explicit verdicts:
// any weekly volume ceiling (no evidence for one — MRV is convention, not
// a measured constant), any push:pull ratio flag, any training-frequency
// flag (the evidence reversed between 2016 and 2019 research waves).

export type SpotterCategory = "Push" | "Pull" | "Legs" | "Core" | "Full Body" | "Cardio" | "Mobility";
export type SpotterTier = "A" | "B" | "C";

// Conor Harris's real published session template shows mobility work
// filling real slots by design (inside rest periods, cooldown) — counting
// it corrupts both the concentration math and the coverage gate. A
// correctness fix, not a feature.
const EXCLUDED_FROM_VOLUME = new Set<SpotterCategory>(["Mobility", "Cardio"]);

export interface SpotterExerciseEntry {
  exerciseName: string;
  category: SpotterCategory | null;
  tier: SpotterTier | null;
  movementPatternId: string | null;
  setCount: number;
  slotIndex: number; // order within its session, 0 = first
  slotCountInSession: number; // total exercise slots in that session
  weekNumber: number;
  // The day (workout) it is in. The back-to-back check runs per day; without it, the week stands in for the day.
  workoutId?: string | null;
  dayIndex?: number | null;
}

// Tier-sensitive per-session concentration ceiling (JTS's real published
// primary/supplementary/assistance classification maps onto this app's
// existing A/B/C tier system) — concentration in tier-C assistance work
// is normal and expected; tier-A primary work is the real anomaly.
// Untiered exercises use the same ceiling as tier-B.
const CONCENTRATION_THRESHOLD: Record<SpotterTier | "untiered", number> = {
  A: 8,
  B: 10,
  C: 14,
  untiered: 10,
};

function dominantTier(entries: SpotterExerciseEntry[]): SpotterTier | "untiered" {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.tier ?? "untiered"] = (counts[e.tier ?? "untiered"] ?? 0) + e.setCount;
  let best: SpotterTier | "untiered" = "untiered";
  let bestCount = -1;
  for (const key of Object.keys(counts)) {
    if (counts[key] > bestCount) {
      bestCount = counts[key];
      best = key as SpotterTier | "untiered";
    }
  }
  return best;
}

export interface VolumeConcentrationFlag {
  movementPatternId: string;
  weekNumber: number;
  totalSets: number;
  threshold: number;
}

// Deliberate emphasis gets placed early in a session; accidental
// accumulation drifts to the end (four independent practitioner sources
// converge on this) — a pattern concentrated in the first half of a
// session's slots is suppressed as intentional; one concentrated in the
// back half is the real accessory-drift signature worth catching.
function isLateSessionDrift(entries: SpotterExerciseEntry[]): boolean {
  const avgSlot = entries.reduce((sum, e) => sum + e.slotIndex, 0) / entries.length;
  const avgSlotCount = entries.reduce((sum, e) => sum + e.slotCountInSession, 0) / entries.length;
  return avgSlot >= avgSlotCount / 2;
}

// Only fires on within-program OUTLIERS — if the same concentration shows
// up in every week at similar magnitude, it's a deliberate specialization
// block, not a slip. `weeklyTotals` is every week's total (including weeks
// under threshold) for this one movement pattern, so "consistent every
// week" can actually be judged against the whole program, not just the
// flagged week in isolation.
function isWithinProgramOutlier(flaggedWeek: number, weeklyTotals: Map<number, number>): boolean {
  const otherWeeks = [...weeklyTotals.entries()].filter(([week]) => week !== flaggedWeek).map(([, total]) => total);
  if (otherWeeks.length === 0) return true; // nothing to compare against — treat as an outlier
  const avgOthers = otherWeeks.reduce((sum, v) => sum + v, 0) / otherWeeks.length;
  const flaggedTotal = weeklyTotals.get(flaggedWeek)!;
  // A consistent specialization block (every week similarly high) is a
  // plan, not a slip — require the flagged week to run meaningfully
  // (50%+) hotter than the program's own typical week for this pattern.
  return flaggedTotal > avgOthers * 1.5;
}

export function detectVolumeConcentration(entries: SpotterExerciseEntry[]): VolumeConcentrationFlag[] {
  const counted = entries.filter((e) => e.category === null || !EXCLUDED_FROM_VOLUME.has(e.category));
  const withPattern = counted.filter((e): e is SpotterExerciseEntry & { movementPatternId: string } => !!e.movementPatternId);

  const byPatternWeek = new Map<string, Map<number, SpotterExerciseEntry[]>>();
  for (const e of withPattern) {
    const weekMap = byPatternWeek.get(e.movementPatternId) ?? new Map<number, SpotterExerciseEntry[]>();
    const list = weekMap.get(e.weekNumber) ?? [];
    list.push(e);
    weekMap.set(e.weekNumber, list);
    byPatternWeek.set(e.movementPatternId, weekMap);
  }

  const flags: VolumeConcentrationFlag[] = [];
  for (const [patternId, weekMap] of byPatternWeek) {
    const weeklyTotals = new Map<number, number>();
    for (const [week, list] of weekMap) {
      weeklyTotals.set(week, list.reduce((sum, e) => sum + e.setCount, 0));
    }
    for (const [week, list] of weekMap) {
      const totalSets = weeklyTotals.get(week)!;
      const tier = dominantTier(list);
      const threshold = CONCENTRATION_THRESHOLD[tier];
      if (totalSets < threshold) continue;
      if (!isLateSessionDrift(list)) continue;
      if (!isWithinProgramOutlier(week, weeklyTotals)) continue;
      flags.push({ movementPatternId: patternId, weekNumber: week, totalSets, threshold });
    }
  }
  return flags;
}

// 3+ near-identical exercises (same movement pattern) stacked back-to-back
// in one session — framed as time-economy, not results (Baz-Valle et al.
// 2019 found exercise variation doesn't improve outcomes over fixed
// selection), so this is always a reflective question, never an assertion.
export interface RedundancyFlag {
  movementPatternId: string;
  weekNumber: number;
  dayIndex: number | null;
  exerciseNames: string[];
}

// The day an entry is in: its workout, or (when the caller has no workout) its week.
const dayKey = (e: { workoutId?: string | null; weekNumber: number }) => (e.workoutId ? `w:${e.workoutId}` : `week:${e.weekNumber}`);

// Per DAY (Nov 24): it used to put a whole week's exercises in one list sorted by slot, so slot 2 of Monday and slot 2 of Wednesday sat "back to back".
export function detectRedundancy(entries: SpotterExerciseEntry[]): RedundancyFlag[] {
  const counted = entries.filter((e) => e.category === null || !EXCLUDED_FROM_VOLUME.has(e.category));
  const byDay = new Map<string, SpotterExerciseEntry[]>();
  for (const e of counted) {
    const list = byDay.get(dayKey(e)) ?? [];
    list.push(e);
    byDay.set(dayKey(e), list);
  }

  const flags: RedundancyFlag[] = [];
  for (const list of byDay.values()) {
    const week = list[0].weekNumber;
    const dayIndex = list[0].dayIndex ?? null;
    const sorted = [...list].sort((a, b) => a.slotIndex - b.slotIndex);
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const samePattern =
        i < sorted.length &&
        sorted[i].movementPatternId !== null &&
        sorted[i].movementPatternId === sorted[runStart].movementPatternId;
      if (!samePattern) {
        const runLength = i - runStart;
        if (runLength >= 3 && sorted[runStart].movementPatternId) {
          flags.push({
            movementPatternId: sorted[runStart].movementPatternId!,
            weekNumber: week,
            dayIndex,
            exerciseNames: sorted.slice(runStart, i).map((e) => e.exerciseName),
          });
        }
        runStart = i;
      }
    }
  }
  return flags;
}

// A repeated exercise with byte-identical tracked-field targets across 4+
// weeks and no progression model attached — a real mechanical duplicate-
// week mistake, zero physiological claim. Checks ALL tracked fields
// (reps/weight/rpe/tempo/etc), not just weight — progressing tempo/ROM/
// stability is real progression too (Shallow/Pre-Script's "progressive
// overstimulus" framing).
export interface FlatRepeatEntry {
  exerciseName: string;
  weekNumber: number;
  targetsFingerprint: string; // caller builds this from every tracked field it cares about
  hasProgressionModel: boolean;
  // The reps are a RANGE (6-8, or a minimum and maximum that differ). A range is itself the progression (double progression: the prescription stays and the client moves inside
  // it), so the same targets week after week is not a flat repeat. Fixed numbers (5x5) are still checked.
  repsAreRange?: boolean;
}

// True when a set's reps are a range: "6-8" (a dash, an en dash or "to" between two numbers), or a structured minimum and maximum that differ.
export function isRepRange(targetReps: string | null | undefined, repMin?: number | null, repMax?: number | null): boolean {
  if (repMin != null && repMax != null && repMin !== repMax) return true;
  return /\d\s*(?:[-–—]|to)\s*\d/i.test(targetReps ?? "");
}

export interface FlatRepeatFlag {
  exerciseName: string;
  weekCount: number;
  weeks: number[];
}

const MIN_FLAT_REPEAT_WEEKS = 4;

export function detectFlatRepeat(entries: FlatRepeatEntry[]): FlatRepeatFlag[] {
  const byExercise = new Map<string, FlatRepeatEntry[]>();
  for (const e of entries) {
    if (e.hasProgressionModel || e.repsAreRange) continue;
    const list = byExercise.get(e.exerciseName) ?? [];
    list.push(e);
    byExercise.set(e.exerciseName, list);
  }

  const flags: FlatRepeatFlag[] = [];
  for (const [exerciseName, list] of byExercise) {
    if (list.length < MIN_FLAT_REPEAT_WEEKS) continue;
    const fingerprint = list[0].targetsFingerprint;
    const allIdentical = list.every((e) => e.targetsFingerprint === fingerprint);
    if (allIdentical) {
      flags.push({
        exerciseName,
        weekCount: list.length,
        weeks: list.map((e) => e.weekNumber).sort((a, b) => a - b),
      });
    }
  }
  return flags;
}

// Biomechanical-tag redundancy (biomechanical_redundancy_consolidation_
// spotter_idea.md) — a harder, tag-level extension of detectRedundancy
// above: three DIFFERENTLY-named, differently-equipped exercises (an
// overhead Y-raise, a banded external rotation, a DB external rotation)
// are mechanically redundant because they share the same prime-mover
// joint-action tag, even though a name/category matcher (or the
// slot-adjacency requirement above) would miss it entirely. No
// adjacency requirement, by design — this is the actual point of the
// extension. Joint-action `prime_mover` tags only, never stabilization-
// axis tags (those are broad, cross-cutting demands nearly every
// compound lift shares, e.g. anti_extension — counting them would
// false-positive constantly). Reuses the redundancy check's own "3, not
// 2" threshold (Baz-Valle et al. 2019 — no evidence 2 overlapping
// exercises is itself a problem).
//
// Nov 24 (Ron, on Robyn's program: rows "all train Elbow Flexion — would Barbell Curl cover it?"), two rules:
//  * per DAY, not per week: the same joint action spread over a week's days is normal; three of it in ONE day is the question. Same threshold.
//  * single-joint work only: an exercise whose prime movers span two or more joints (a row: shoulder, shoulder blade and elbow; a press; a squat: hip and knee) is a compound,
//    and a compound is not curl or tricep work. Compounds are left to the same-pattern back-to-back check above. The shoulder and shoulder blade count as one joint here, and
//    the elbow, forearm and wrist as one, so a lateral raise or a curl is still single-joint.
export interface BiomechTaggedEntry {
  exerciseName: string;
  weekNumber: number;
  primeMoverTagKeys: string[];
  // The day it is in (without it, the week stands in for the day).
  workoutId?: string | null;
  dayIndex?: number | null;
  // biomech_tags.joint of each prime-mover tag, in the same order (without it, the joint is read from the tag's key: shoulder_extension is the shoulder).
  primeMoverJoints?: (string | null)[];
  // Mobility and Cardio work is left out, as in the volume and back-to-back checks (three hip drills on a mobility day are the point of the day).
  category?: SpotterCategory | null;
}

export interface BiomechRedundancyFlag {
  tagKey: string;
  weekNumber: number;
  dayIndex: number | null;
  exerciseNames: string[];
}

const BIOMECH_REDUNDANCY_THRESHOLD = 3;

const JOINT_REGION: Record<string, string> = {
  shoulder: "shoulder",
  scapula: "shoulder",
  elbow: "arm",
  forearm: "arm",
  wrist: "arm",
  hip: "hip",
  knee: "knee",
  ankle: "ankle",
  thoracic: "spine",
  lumbar: "spine",
  cervical: "spine",
  spine: "spine",
};

function regionOf(tagKey: string, joint: string | null | undefined): string {
  const j = (joint ?? tagKey.split("_")[0]).toLowerCase();
  return JOINT_REGION[j] ?? JOINT_REGION[j.split("_")[0]] ?? j;
}

// One joint does the work (a curl, a pushdown, a hip thrust, a lateral raise). Two or more = a compound.
export function isSingleJoint(e: Pick<BiomechTaggedEntry, "primeMoverTagKeys" | "primeMoverJoints">): boolean {
  if (e.primeMoverTagKeys.length === 0) return false;
  return new Set(e.primeMoverTagKeys.map((k, i) => regionOf(k, e.primeMoverJoints?.[i]))).size === 1;
}

export function detectBiomechRedundancy(entries: BiomechTaggedEntry[]): BiomechRedundancyFlag[] {
  const byDayTag = new Map<string, { tagKey: string; weekNumber: number; dayIndex: number | null; names: Set<string> }>();
  for (const e of entries) {
    if (!isSingleJoint(e)) continue;
    if (e.category && EXCLUDED_FROM_VOLUME.has(e.category)) continue;
    for (const tagKey of e.primeMoverTagKeys) {
      const key = `${dayKey(e)}::${tagKey}`;
      const group = byDayTag.get(key) ?? { tagKey, weekNumber: e.weekNumber, dayIndex: e.dayIndex ?? null, names: new Set<string>() };
      group.names.add(e.exerciseName);
      byDayTag.set(key, group);
    }
  }

  const flags: BiomechRedundancyFlag[] = [];
  for (const g of byDayTag.values()) {
    if (g.names.size < BIOMECH_REDUNDANCY_THRESHOLD) continue;
    flags.push({ tagKey: g.tagKey, weekNumber: g.weekNumber, dayIndex: g.dayIndex, exerciseNames: [...g.names].sort() });
  }
  return flags;
}

// The exercise to suggest instead (Nov 24): only one in the SAME movement pattern as the flagged exercises, so Ab Wheel is never offered for rows or Bench for pushdowns. The
// pattern is the one most of the flagged exercises are in, and at least two of them must be in it; otherwise there is no suggestion (the headline then just asks). Among the
// candidates in that pattern (the caller passes only the coach's own exercises with the flagged tag as a prime mover): tier A > B > C > none, then by name.
export interface AlternativeCandidate {
  name: string;
  tier: SpotterTier | null;
  patternIds: string[];
}

const TIER_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };

export function sharedPattern(flaggedNames: string[], patternIdsByName: Map<string, string[]>): string | null {
  const counts = new Map<string, number>();
  for (const n of flaggedNames) for (const p of new Set(patternIdsByName.get(n) ?? [])) counts.set(p, (counts.get(p) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && best[1] >= 2 ? best[0] : null;
}

export function pickSamePatternAlternative(flaggedNames: string[], patternIdsByName: Map<string, string[]>, candidates: AlternativeCandidate[]): string | null {
  const pattern = sharedPattern(flaggedNames, patternIdsByName);
  if (!pattern) return null;
  const names = candidates
    .filter((c) => c.patternIds.includes(pattern) && !flaggedNames.includes(c.name))
    .sort((a, b) => (TIER_ORDER[b.tier ?? ""] ?? 0) - (TIER_ORDER[a.tier ?? ""] ?? 0) || a.name.localeCompare(b.name));
  return names[0]?.name ?? null;
}

// Where a flag is, for its headline: "Day 2", or "Week 3, Day 2" in a program of more than one week, with how many other days have the same thing.
export function dayLabel(f: { weekNumber: number; dayIndex: number | null }, multiWeek: boolean): string {
  if (f.dayIndex == null) return `Week ${f.weekNumber}`;
  return multiWeek ? `Week ${f.weekNumber}, Day ${f.dayIndex}` : `Day ${f.dayIndex}`;
}

// One flag per thing (its dismissal key), at its first day; the other days with the same thing are counted, not listed again (a 4-week program used to show it 4 times).
export function firstOfEach<T extends { weekNumber: number; dayIndex: number | null }>(flags: T[], keyOf: (f: T) => string): { flag: T; moreDays: number }[] {
  const byKey = new Map<string, T[]>();
  for (const f of flags) byKey.set(keyOf(f), [...(byKey.get(keyOf(f)) ?? []), f]);
  return [...byKey.values()].map((list) => {
    const sorted = [...list].sort((a, b) => a.weekNumber - b.weekNumber || (a.dayIndex ?? 0) - (b.dayIndex ?? 0));
    return { flag: sorted[0], moreDays: sorted.length - 1 };
  });
}

// More main lifting days in a week than the client said they can train (Ron, Nov 24: "A lot of times they'll say 3 days a week. And that'll be big lifts, but I'll assign
// at-home mobility stuff ... for the in-between days, which are more or less optional ... So I don't want to be getting spammed."). Only for a program of ONE client whose goal
// sheet gives days_per_week. A lifting day is a day (one workout) with at least one Push, Pull, Legs or Full Body exercise: a day of only Core, Cardio or Mobility work (the
// optional in-between days), or of exercises with no category, never counts. One flag per program, for its busiest week (the earliest of equals), never one per week.
export const LIFTING_DAY_CATEGORIES: ReadonlySet<SpotterCategory> = new Set<SpotterCategory>(["Push", "Pull", "Legs", "Full Body"]);

export interface ProgramDayEntry {
  workoutId: string;
  weekNumber: number;
  category: SpotterCategory | null;
}

export interface LiftingDaysFlag {
  weekNumber: number;
  liftingDays: number;
  daysPerWeek: number;
}

export function detectTooManyLiftingDays(entries: ProgramDayEntry[], daysPerWeek: number | null | undefined): LiftingDaysFlag | null {
  if (daysPerWeek == null || !Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) return null;
  const liftingDaysByWeek = new Map<number, Set<string>>();
  for (const e of entries) {
    if (!e.category || !LIFTING_DAY_CATEGORIES.has(e.category)) continue;
    const days = liftingDaysByWeek.get(e.weekNumber) ?? new Set<string>();
    days.add(e.workoutId);
    liftingDaysByWeek.set(e.weekNumber, days);
  }
  let worst: LiftingDaysFlag | null = null;
  for (const [weekNumber, days] of [...liftingDaysByWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (days.size > daysPerWeek && (!worst || days.size > worst.liftingDays)) worst = { weekNumber, liftingDays: days.size, daysPerWeek };
  }
  return worst;
}

// Missing-pattern coverage — deliberately scoped to this app's existing
// 7-category system (exercise_library.category), not a new movement-
// pattern taxonomy. Push/Pull/Legs are the three "training" categories
// checked; Cardio/Mobility/Core/Full Body are never flagged as "missing"
// since they're not universal expectations the way a lifting split is.
//
// Two-mode name matching: a program name naming a narrow theme
// ("Squatober," any name in `narrowThemeSuppressionNames`) never flags a
// missing pattern — the name explains it. A name making a
// comprehensiveness CLAIM ("full body," "total body," "complete," "whole
// body") makes a missing pattern MORE worth flagging, since the name
// itself is the promise being broken. Absent either signal, default is
// silence (the safe default — most program names are neither).
const COMPREHENSIVENESS_CLAIM_PHRASES = ["full body", "total body", "complete", "whole body"];

export interface MissingPatternFlag {
  category: "Push" | "Pull" | "Legs";
}

export function detectMissingPatternCoverage(
  programName: string,
  categoriesUsed: Set<string>
): MissingPatternFlag[] {
  const nameLower = programName.toLowerCase();
  const claimsComprehensiveness = COMPREHENSIVENESS_CLAIM_PHRASES.some((phrase) => nameLower.includes(phrase));
  if (!claimsComprehensiveness) return [];

  const required: MissingPatternFlag["category"][] = ["Push", "Pull", "Legs"];
  return required.filter((c) => !categoriesUsed.has(c)).map((category) => ({ category }));
}
