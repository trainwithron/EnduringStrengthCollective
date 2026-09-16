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
  exerciseNames: string[];
}

export function detectRedundancy(entries: SpotterExerciseEntry[]): RedundancyFlag[] {
  const counted = entries.filter((e) => e.category === null || !EXCLUDED_FROM_VOLUME.has(e.category));
  const byWeek = new Map<number, SpotterExerciseEntry[]>();
  for (const e of counted) {
    const list = byWeek.get(e.weekNumber) ?? [];
    list.push(e);
    byWeek.set(e.weekNumber, list);
  }

  const flags: RedundancyFlag[] = [];
  for (const [week, list] of byWeek) {
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
    if (e.hasProgressionModel) continue;
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
export interface BiomechTaggedEntry {
  exerciseName: string;
  weekNumber: number;
  primeMoverTagKeys: string[];
}

export interface BiomechRedundancyFlag {
  tagKey: string;
  weekNumber: number;
  exerciseNames: string[];
}

const BIOMECH_REDUNDANCY_THRESHOLD = 3;

export function detectBiomechRedundancy(entries: BiomechTaggedEntry[]): BiomechRedundancyFlag[] {
  const namesByWeekTag = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const tagKey of e.primeMoverTagKeys) {
      const key = `${e.weekNumber}::${tagKey}`;
      const names = namesByWeekTag.get(key) ?? new Set<string>();
      names.add(e.exerciseName);
      namesByWeekTag.set(key, names);
    }
  }

  const flags: BiomechRedundancyFlag[] = [];
  for (const [key, names] of namesByWeekTag) {
    if (names.size < BIOMECH_REDUNDANCY_THRESHOLD) continue;
    const separatorIndex = key.indexOf("::");
    const weekNumber = Number(key.slice(0, separatorIndex));
    const tagKey = key.slice(separatorIndex + 2);
    flags.push({ tagKey, weekNumber, exerciseNames: [...names].sort() });
  }
  return flags;
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
