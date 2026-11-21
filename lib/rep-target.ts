// A set's rep target as the coach (or the AI builder) wrote it: "8", a range "12-15" (also "12–15", "12 - 15", "12 to 15"), "10+", "AMRAP" or nothing (Ron, Nov 21, a live workout:
// a range gave the reps box no target at all, because it was read as a plain number). What the logger needs from it:
//   value: the number the reps box suggests, which the done check and a tap on the grey number fill in: the LOW end of a range, the number itself, or nothing;
//   hint:  what the box shows in grey while empty: the whole range ("12–15") or the number. Nothing for "10+" or AMRAP (unchanged: the set's kind says AMRAP under it).
export interface RepTarget {
  value: number | null;
  hint: string | null;
}

const RANGE = /^(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})$/i;
// a plain number, a decimal too ("8.5" rounds to 9, as the old reading did)
const PLAIN = /^\d{1,3}(?:\.\d+)?$/;

export function parseRepTarget(text: string | number | null | undefined): RepTarget {
  if (typeof text === "number") return Number.isFinite(text) && text > 0 ? { value: Math.round(text), hint: String(Math.round(text)) } : { value: null, hint: null };
  const t = (text ?? "").trim();
  if (!t) return { value: null, hint: null };
  if (PLAIN.test(t)) {
    const n = Math.round(Number(t));
    return n > 0 ? { value: n, hint: String(n) } : { value: null, hint: null };
  }
  const range = RANGE.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    if (low <= 0) return { value: null, hint: null };
    return low === high ? { value: low, hint: String(low) } : { value: low, hint: `${low}–${high}` };
  }
  return { value: null, hint: null };
}

/** The number a rep target stands for when it is compared or suggested (the low end of a range). */
export function repTargetValue(text: string | number | null | undefined): number | null {
  return parseRepTarget(text).value;
}
