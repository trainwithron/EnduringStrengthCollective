// The one graph at the bottom of the Progress tab (release CC): body weight over the calorie target and what the client logged, on a shared time axis with two labelled value axes (pounds on the
// left, calories on the right). This file is the geometry only (scales, paths, the readout under the pointer), so it is tested without a screen. Dates are YYYY-MM-DD keys.

export type OverlayRange = "3M" | "6M" | "1Y" | "All";
export interface DayPoint {
  date: string;
  value: number;
}

export function dayNumber(key: string): number {
  return Math.round(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86400000);
}

function keyOfDay(day: number): string {
  const d = new Date(day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function rangeStartDay(range: OverlayRange, todayKey: string, firstKey: string): number {
  const today = dayNumber(todayKey);
  const first = dayNumber(firstKey);
  const back = range === "3M" ? 91 : range === "6M" ? 182 : range === "1Y" ? 365 : Infinity;
  return Math.max(first, today - back);
}

// Round numbers for an axis: about `count` steps, a step of 1, 2, 5 or 10 times a power of ten, covering [min, max].
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (max === min) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: lo, max: hi, ticks };
}

export interface OverlayInput {
  weight: DayPoint[];
  target: DayPoint[];
  intake: DayPoint[];
}

export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OverlayModel {
  startDay: number;
  endDay: number;
  xOf: (day: number) => number;
  dayAt: (x: number) => number;
  weightScale: { min: number; max: number; ticks: number[] } | null;
  calorieScale: { min: number; max: number; ticks: number[] } | null;
  weightY: (v: number) => number;
  calorieY: (v: number) => number;
  paths: { weight: string; target: string; intake: string };
  weightDots: { x: number; y: number; date: string; value: number }[];
  xTicks: { x: number; label: string }[];
  series: { weight: DayPoint[]; target: DayPoint[]; intake: DayPoint[] };
  hasData: boolean;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tickLabel(day: number, spanDays: number): string {
  const key = keyOfDay(day);
  const month = MONTH_ABBR[Number(key.slice(5, 7)) - 1];
  return spanDays > 400 ? `${month} ${key.slice(2, 4)}` : `${month} ${Number(key.slice(8, 10))}`;
}

function pathOf(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export function buildOverlay(input: OverlayInput, range: OverlayRange, todayKey: string, frame: Frame): OverlayModel {
  const all = [...input.weight, ...input.target, ...input.intake];
  const firstKey = all.length > 0 ? all.reduce((a, b) => (a.date < b.date ? a : b)).date : todayKey;
  const endDay = dayNumber(todayKey);
  const startDay = rangeStartDay(range, todayKey, firstKey);
  const clip = (points: DayPoint[]) =>
    points
      .filter((p) => dayNumber(p.date) >= startDay && dayNumber(p.date) <= endDay)
      .sort((a, b) => a.date.localeCompare(b.date));
  const series = { weight: clip(input.weight), target: clip(input.target), intake: clip(input.intake) };

  const plotW = frame.width - frame.left - frame.right;
  const plotH = frame.height - frame.top - frame.bottom;
  const span = Math.max(1, endDay - startDay);
  const xOf = (day: number) => frame.left + ((day - startDay) / span) * plotW;
  const dayAt = (x: number) => Math.round(startDay + ((x - frame.left) / plotW) * span);

  const weightValues = series.weight.map((p) => p.value);
  const calorieValues = [...series.target, ...series.intake].map((p) => p.value);
  const weightScale = weightValues.length > 0 ? niceScale(Math.min(...weightValues), Math.max(...weightValues)) : null;
  const calorieScale = calorieValues.length > 0 ? niceScale(Math.min(...calorieValues), Math.max(...calorieValues)) : null;
  const scaleY = (scale: { min: number; max: number } | null) => (v: number) => (scale ? frame.top + (1 - (v - scale.min) / (scale.max - scale.min || 1)) * plotH : frame.top + plotH);
  const weightY = scaleY(weightScale);
  const calorieY = scaleY(calorieScale);

  const pts = (list: DayPoint[], y: (v: number) => number) => list.map((p) => ({ x: xOf(dayNumber(p.date)), y: y(p.value), date: p.date, value: p.value }));
  const weightPoints = pts(series.weight, weightY);
  const targetPoints = pts(series.target, calorieY);
  const intakePoints = pts(series.intake, calorieY);

  const xTicks: { x: number; label: string }[] = [];
  const tickCount = 5;
  for (let i = 0; i < tickCount; i++) {
    const day = Math.round(startDay + (span * i) / (tickCount - 1));
    xTicks.push({ x: xOf(day), label: tickLabel(day, span) });
  }

  return {
    startDay,
    endDay,
    xOf,
    dayAt,
    weightScale,
    calorieScale,
    weightY,
    calorieY,
    paths: { weight: pathOf(weightPoints), target: pathOf(targetPoints), intake: pathOf(intakePoints) },
    weightDots: weightPoints,
    xTicks,
    series,
    hasData: weightPoints.length + targetPoints.length + intakePoints.length > 0,
  };
}

export interface Readout {
  date: string;
  weight: number | null;
  target: number | null;
  intake: number | null;
}

// What the pointer is over: the date, and for each series its value on that day. Weight and intake are shown only for a day they were actually logged (weight within a day either side so a
// pointer between two columns still finds it); the target is a standing number, so the latest one set on or before the day is shown.
export function readoutAt(series: OverlayModel["series"], day: number): Readout {
  const exact = (list: DayPoint[], slack: number) => {
    let best: DayPoint | null = null;
    let bestGap = Infinity;
    for (const p of list) {
      const gap = Math.abs(dayNumber(p.date) - day);
      if (gap <= slack && gap < bestGap) {
        best = p;
        bestGap = gap;
      }
    }
    return best ? best.value : null;
  };
  let standing: DayPoint | null = null;
  for (const p of series.target) {
    if (dayNumber(p.date) <= day) standing = p;
    else break;
  }
  return { date: keyOfDay(day), weight: exact(series.weight, 1), target: standing ? standing.value : null, intake: exact(series.intake, 0) };
}
