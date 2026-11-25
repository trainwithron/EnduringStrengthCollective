// The client cards on the coach's Nutrition page (Ron, Nov 24: "cards for them like they are on my client page ... their macro prescription and ... a bar graph of each, like protein,
// carbs, fats, calories ... in the background it'll have their prescription, and then ... the percentage that they actually have completed of each one"). Pure: what each card shows.
// The numbers come from the week's reads (lib/coach-nutrition-week.ts), so a card never needs a read of its own.

export type MacroKey = "protein" | "carbs" | "fat" | "calories";
export type Period = "average" | "today";
export const DEFAULT_PERIOD: Period = "average";
// The week the cards count (lib/coach-nutrition-week WEEK_DAYS; kept here so the cards, which run in the browser, never load the server reads).
export const CARD_WEEK_DAYS = 7;
export const PERIOD_LABELS: Record<Period, string> = { average: "7-day average", today: "Today" };

export interface Macros {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  calories: number | null;
}

export interface PeriodMacros {
  // What they ate: today's totals, or the average over the days they logged. Null when nothing with numbers was logged.
  eaten: Macros | null;
  // Their prescription for the same days. Null when there is none.
  target: Macros | null;
}

export interface CardMacros {
  today: PeriodMacros;
  // `days`: how many logged days the average is over.
  average: PeriodMacros & { days: number };
}

export const MACRO_ORDER: { key: MacroKey; label: string; unit: string }[] = [
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "calories", label: "Calories", unit: "" },
];

// Green for 90 to 110 percent, gold under, red over 110 percent. "neutral" is no judgement at all (no target for that number, or calories in Youth/Team mode).
// From the whole percent the coach is shown, so a bar that reads "90%" or "110%" is always green (the legend's 90–110%).
export type Band = "hit" | "under" | "over" | "neutral";
export const HIT_LOW = 90;
export const HIT_HIGH = 110;

export function bandFor(percent: number | null): Band {
  if (percent == null) return "neutral";
  if (percent > HIT_HIGH) return "over";
  if (percent >= HIT_LOW) return "hit";
  return "under";
}

// Said with the numbers for a screen reader (the colour alone says it on screen).
const BAND_WORD: Record<Band, string | null> = { hit: "on target", under: "under", over: "over", neutral: null };

export interface Bar {
  key: MacroKey;
  label: string;
  unit: string;
  eaten: number;
  target: number | null;
  // Whole percent of the prescription (null without one); the fill is capped at 100 so the bar never runs past its track.
  percent: number | null;
  fill: number;
  band: Band;
  ariaLabel: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function barFor(key: MacroKey, eaten: number, target: number | null, youth: boolean): Bar {
  const meta = MACRO_ORDER.find((m) => m.key === key)!;
  const hasTarget = target != null && target > 0;
  const share = hasTarget ? eaten / target : null;
  const percent = share == null ? null : Math.round(share * 100);
  // Youth/Team mode is protein-first with no calorie-deficit framing: calories are never judged there, over or under.
  const band = youth && key === "calories" ? "neutral" : bandFor(percent);
  const unitWord = meta.unit || "kcal";
  const word = BAND_WORD[band];
  const ariaLabel = hasTarget
    ? `${meta.label}: ${fmt(eaten)} of ${fmt(target)} ${unitWord} (${percent}%${word ? `, ${word}` : ""})`
    : `${meta.label}: ${fmt(eaten)} ${unitWord}, no prescription`;
  return { key, label: meta.label, unit: meta.unit, eaten: Math.round(eaten), target: hasTarget ? Math.round(target) : null, percent, fill: share == null ? 0 : Math.min(share, 1) * 100, band, ariaLabel };
}

const hasAny = (m: Macros | null | undefined): m is Macros => !!m && (m.protein != null || m.carbs != null || m.fat != null || m.calories != null);

// "180P · 250C · 70F · 2,350 kcal": the prescription in words, for a card with nothing logged.
export function prescriptionText(t: Macros): string {
  const parts = [
    t.protein != null ? `${fmt(t.protein)}P` : null,
    t.carbs != null ? `${fmt(t.carbs)}C` : null,
    t.fat != null ? `${fmt(t.fat)}F` : null,
    t.calories != null ? `${fmt(t.calories)} kcal` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export const TRACKING_OFF_CARD = "Food tracking is off for this client.";
export const MACROS_OFF_CARD = "Macros off for this client: logging only.";
export const NO_MACROS_CARD = "No macros set yet.";
// The rule the Clients list already keeps (Release B3): someone under 18, whose age is not on file, or with "No automatic nutrition suggestions" on is never compared with a target.
export const DAYS_ONLY_CARD = "Days logged only for this client: under 18, age not on file, or no automatic nutrition suggestions.";

export type CardBody =
  | { kind: "message"; text: string }
  | { kind: "nothing_logged"; prescription: string; period: Period }
  | { kind: "bars"; bars: Bar[] };

export interface CardFlags {
  trackingOff: boolean;
  // The coach's "No macros for <client>" switch.
  macrosOff: boolean;
  // Compared with a target at all (see DAYS_ONLY_CARD).
  comparable: boolean;
  // The client's group is in Youth/Team mode.
  youth: boolean;
}

export function cardBody(macros: CardMacros | null, flags: CardFlags, period: Period): CardBody | null {
  if (flags.trackingOff) return { kind: "message", text: TRACKING_OFF_CARD };
  if (flags.macrosOff) return { kind: "message", text: MACROS_OFF_CARD };
  if (!flags.comparable) return { kind: "message", text: DAYS_ONLY_CARD };
  // The week's numbers could not be read: the page already says so once, so the card just shows the person.
  if (!macros) return null;
  const p = period === "today" ? macros.today : macros.average;
  if (!hasAny(p.target)) return { kind: "message", text: NO_MACROS_CARD };
  if (!hasAny(p.eaten)) return { kind: "nothing_logged", prescription: prescriptionText(p.target), period };
  const eaten = p.eaten;
  const target = p.target;
  return { kind: "bars", bars: MACRO_ORDER.map((m) => barFor(m.key, eaten[m.key] ?? 0, target[m.key], flags.youth)) };
}

export function nothingLoggedLine(period: Period): string {
  return period === "today" ? "Nothing logged today yet." : "Nothing logged yet.";
}

// "Last log today" / "Last log yesterday" / "Last log Nov 22" / "No logs yet".
export function lastLogLine(lastLogDate: string | null, todayKey: string, yesterdayKey: string, dateLabel: (key: string) => string): string {
  if (!lastLogDate) return "No logs yet";
  if (lastLogDate === todayKey) return "Last log today";
  if (lastLogDate === yesterdayKey) return "Last log yesterday";
  return `Last log ${dateLabel(lastLogDate)}`;
}

// The week's per-day numbers put together for one client. `days` are the logged days in the window (oldest first), each with what was eaten and that day's prescription.
// The average is over the logged days that have numbers, so a skipped day never drags it toward zero, and it leaves today out (today is not over yet: breakfast alone would pull a
// full week toward gold) unless today is the only day logged. Its prescription is the average of those same days' prescriptions (a training day and a rest day can differ), else
// today's when none of them had one. A macro missing on a logged entry counts as 0 in the day's total (every live entry carries all four).
export function cardMacros(args: {
  todayKey: string;
  days: { date: string; eaten: Macros }[];
  targetFor: (date: string) => Macros | null;
}): CardMacros {
  const todayTarget = args.targetFor(args.todayKey);
  const withNumbers = args.days.filter((d) => hasAny(d.eaten));
  const todayDay = withNumbers.find((d) => d.date === args.todayKey) ?? null;
  const earlier = withNumbers.filter((d) => d.date !== args.todayKey);
  const averaged = earlier.length > 0 ? earlier : withNumbers;
  const keys = MACRO_ORDER.map((m) => m.key);
  let eatenAvg: Macros | null = null;
  let targetAvg: Macros | null = todayTarget;
  if (averaged.length > 0) {
    eatenAvg = { protein: null, carbs: null, fat: null, calories: null };
    for (const k of keys) eatenAvg[k] = averaged.reduce((s, d) => s + (d.eaten[k] ?? 0), 0) / averaged.length;
    const targets = averaged.map((d) => args.targetFor(d.date)).filter(hasAny);
    if (targets.length > 0) {
      const avg: Macros = { protein: null, carbs: null, fat: null, calories: null };
      for (const k of keys) {
        const vals = targets.map((t) => t[k]).filter((v): v is number => v != null);
        avg[k] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : todayTarget?.[k] ?? null;
      }
      targetAvg = avg;
    }
  }
  return {
    today: { eaten: todayDay ? todayDay.eaten : null, target: todayTarget },
    average: { eaten: eatenAvg, target: targetAvg, days: averaged.length },
  };
}
