// Side-by-side progress photos (wave 2, P5; Ron, Nov 20): the client picks two dates and sees one photo from each beside the other, each with its date and the
// weigh-in nearest that date. Pure. Photos stay private by default: this only ever arranges the photos the caller already may read (the client's own, or the ones
// the client shared with the coach); it never widens who sees what.

export interface ComparePhoto {
  id: string;
  takenDate: string; // YYYY-MM-DD
  storagePath: string;
  caption?: string | null;
}

export interface WeighIn {
  date: string; // YYYY-MM-DD
  weight: number;
}

export interface CompareDay {
  date: string;
  photos: ComparePhoto[]; // that day's photos, in the order taken
}

/** The days that have photos, oldest first, each with its photos. */
export function photoDays(photos: ComparePhoto[]): CompareDay[] {
  const by = new Map<string, ComparePhoto[]>();
  for (const p of photos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.takenDate)) continue;
    const list = by.get(p.takenDate) ?? [];
    list.push(p);
    by.set(p.takenDate, list);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, photos: list }));
}

/** What opens first: the first day and the latest day (before and now). Null with fewer than two days of photos (nothing to compare yet). */
export function defaultPair(days: CompareDay[]): { before: string; after: string } | null {
  if (days.length < 2) return null;
  return { before: days[0].date, after: days[days.length - 1].date };
}

/** A pair the person chose, put in order (the earlier date on the left); the same date twice is no comparison. */
export function orderPair(a: string, b: string): { before: string; after: string } | null {
  if (a === b) return null;
  return a < b ? { before: a, after: b } : { before: b, after: a };
}

const dayNumber = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86400000;

/** The weigh-in to show under a photo: that day's, else the nearest within a week either side (the earlier one on a tie). Null when none is that close. */
export function weightNear(date: string, weighIns: WeighIn[], withinDays = 7): WeighIn | null {
  let best: WeighIn | null = null;
  let bestGap = Infinity;
  for (const w of weighIns) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const gap = Math.abs(dayNumber(w.date) - dayNumber(date));
    if (gap > withinDays) continue;
    if (gap < bestGap || (gap === bestGap && best && w.date < best.date)) {
      best = w;
      bestGap = gap;
    }
  }
  return best;
}

/** "12 weeks apart", "5 days apart", "1 year 2 months apart": the gap between the two photos, in the plain words a person would say. */
export function gapWords(before: string, after: string): string {
  const days = Math.round(Math.abs(dayNumber(after) - dayNumber(before)));
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} apart`;
  if (days < 7 * 13) {
    const weeks = Math.round(days / 7);
    return `${weeks} weeks apart`;
  }
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months apart`;
  const years = Math.floor(months / 12);
  const rest = months - years * 12;
  return `${years} year${years === 1 ? "" : "s"}${rest > 0 ? ` ${rest} month${rest === 1 ? "" : "s"}` : ""} apart`;
}

// The numbers under the two photos (wave 2, P5): how far apart they are, the body-weight change and the waist change between them, each from the reading nearest
// each photo's date (weightNear, within a week). A change is left out (null) unless both dates have a reading close enough. Weights and waists are as stored
// (pounds, inches); the caller shows them in the person's unit.
export interface CompareStats {
  gap: string;
  weightChange: number | null;
  waistChange: number | null;
}

export function compareStats(before: string, after: string, weighIns: WeighIn[], waists: WeighIn[]): CompareStats {
  const change = (list: WeighIn[]) => {
    const a = weightNear(before, list);
    const b = weightNear(after, list);
    // the same reading under both photos is no change worth showing
    if (!a || !b || a.date === b.date) return null;
    return Number((b.weight - a.weight).toFixed(1));
  };
  return { gap: gapWords(before, after), weightChange: change(weighIns), waistChange: change(waists) };
}

/** "−8 lb" / "+0.5 in" / "0 lb": a change with its sign (a true minus sign), for the stats row. */
export function signedChange(n: number, unit: string): string {
  const v = Number(Math.abs(n).toFixed(1));
  if (v === 0) return `0 ${unit}`;
  return `${n < 0 ? "−" : "+"}${v} ${unit}`;
}
