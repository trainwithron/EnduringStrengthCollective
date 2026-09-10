// Pure math behind each program card's generated visual (no cover photo
// set) — a sparkline of planned-vs-actual weekly volume plus a 3-bucket
// exercise-category split bar. No chart library, same hand-rolled-SVG
// convention as lib/trend-chart-math.ts.

// Same parsing rule as components/logging/start-workout-button.tsx's
// private parseRepsTarget — exported here so both the real set-logging
// path and this "planned volume" estimate treat target_reps text
// identically. target_reps is free text ("8", "8-10", "AMRAP") since a
// coach can prescribe ranges/tags; only a plain number contributes to a
// volume estimate.
export function parseNumericReps(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export interface WeeklyVolumePoint {
  week: number;
  plannedIndexed: number;
  actualIndexed: number | null;
}

// Indexes both series to "% of week 1" before plotting — planned volume
// (rep-count x prescribed weight) and actual volume (real logged weight
// x reps) can differ in absolute scale for reasons that have nothing to
// do with progress (e.g. conservative starting weights), so a raw
// dual-axis overlay would mislead. Indexing to a shared baseline costs
// nothing extra since both numbers already exist.
export function computeWeeklyVolumeSeries(
  plannedByWeek: Map<number, number>,
  actualByWeek: Map<number, number>,
  weekCount: number
): WeeklyVolumePoint[] {
  const plannedWeek1 = plannedByWeek.get(1) ?? 0;
  const points: WeeklyVolumePoint[] = [];
  for (let week = 1; week <= weekCount; week++) {
    const planned = plannedByWeek.get(week) ?? 0;
    const plannedIndexed = plannedWeek1 > 0 ? (planned / plannedWeek1) * 100 : 0;

    const actual = actualByWeek.get(week);
    // A week with no real logs yet renders as a gap in the actual line,
    // never a fake zero — indexing a real 0 would falsely read as "no
    // volume this week" instead of "not logged yet."
    let actualIndexed: number | null = null;
    if (actual !== undefined) {
      actualIndexed = plannedWeek1 > 0 ? (actual / plannedWeek1) * 100 : 0;
    }

    points.push({ week, plannedIndexed, actualIndexed });
  }
  return points;
}

export interface CategorySplit {
  upper: number;
  lower: number;
  conditioning: number;
}

// Confirmed mapping (2026-09-10): Push/Pull -> Upper, Legs -> Lower,
// everything else (Core, Full Body, Cardio, Mobility) -> Conditioning.
// An explicitly imperfect proxy — a "Full Body" exercise like a deadlift
// or overhead press really belongs in Lower or Upper respectively, but
// the category field can't express that per-exercise nuance today. A
// pure function, so re-tuning this (or swapping the input to a more
// precise field later) is a one-function change.
const UPPER_CATEGORIES = new Set(["Push", "Pull"]);
const LOWER_CATEGORIES = new Set(["Legs"]);

export function bucketCategorySplit(categoryCounts: Record<string, number>): CategorySplit {
  let upper = 0;
  let lower = 0;
  let conditioning = 0;

  for (const [category, count] of Object.entries(categoryCounts)) {
    if (UPPER_CATEGORIES.has(category)) upper += count;
    else if (LOWER_CATEGORIES.has(category)) lower += count;
    else conditioning += count;
  }

  const total = upper + lower + conditioning;
  if (total === 0) {
    // No categorized exercises at all — falls back to a single
    // Conditioning bucket rather than dividing by zero.
    return { upper: 0, lower: 0, conditioning: 100 };
  }

  // Round to whole percentages while keeping the three values summing to
  // exactly 100 — give any rounding remainder to the largest bucket
  // rather than let "45 + 40 + 15" silently become "45 + 40 + 14 = 99".
  const rawUpper = (upper / total) * 100;
  const rawLower = (lower / total) * 100;
  const rawConditioning = (conditioning / total) * 100;
  const rounded = [rawUpper, rawLower, rawConditioning].map(Math.round);
  const diff = 100 - (rounded[0] + rounded[1] + rounded[2]);
  const largestIndex = [rawUpper, rawLower, rawConditioning].indexOf(
    Math.max(rawUpper, rawLower, rawConditioning)
  );
  rounded[largestIndex] += diff;

  return { upper: rounded[0], lower: rounded[1], conditioning: rounded[2] };
}

export interface SparklinePath {
  // One "M ... L ... L ..." subpath per unbroken run of real values —
  // a null (not-yet-logged week) breaks the line into a new subpath
  // instead of interpolating across the gap or plotting a fake zero.
  linePath: string;
  // Only defined when the whole series has no gaps — an area fill under
  // a broken line would visually claim volume for weeks that were never
  // logged, so gapped series render as a line only, no fill.
  areaPath: string | null;
  points: ({ x: number; y: number } | null)[];
}

// Ported from the demo artifact's vanilla-JS buildSparkPath — plots a
// single series (gaps allowed) into a 0..width / 0..height viewBox. Two
// series (planned + actual) sharing one scale are built by calling this
// twice with a shared min/max, passed in explicitly rather than each
// series scaling itself independently (which would make them
// incomparable).
export function buildSparklinePath(
  values: (number | null)[],
  width: number,
  height: number,
  range?: { min: number; max: number }
): SparklinePath {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const min = range?.min ?? Math.min(...finite);
  const max = range?.max ?? Math.max(...finite);
  const span = max - min || 1;
  const pad = height * 0.12;

  const points = values.map((v, i) => {
    if (v === null || !Number.isFinite(v)) return null;
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return { x, y };
  });

  let line = "";
  let startNewSubpath = true;
  for (const p of points) {
    if (!p) {
      startNewSubpath = true;
      continue;
    }
    line += `${startNewSubpath ? "M" : " L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    startNewSubpath = false;
  }

  // A lone single point (e.g. a one-week program with nothing else to
  // compare against) has no real "shape" to fill — closing the path back
  // through the bottom corners from just one point draws a misleading
  // wedge that reads as a decline, not a real trend line. Same "not
  // enough data" guard TrendChart already applies for its own line.
  const hasGap = points.some((p) => p === null);
  const validCount = points.filter((p) => p !== null).length;
  const area = hasGap || validCount < 2 ? null : `${line} L ${width} ${height} L 0 ${height} Z`;

  return { linePath: line, areaPath: area, points };
}
