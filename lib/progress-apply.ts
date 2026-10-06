// The small edits an applied option makes to a client's next workout. Pure, so each can be tested. Nothing here is automatic: the panel only calls these
// when the coach taps Apply on a draft the coach may have edited.

// The new target weight for one set: the set's own target plus the step, or, when the set has no target yet, the weight the client has been lifting plus
// the step. Rounded to a quarter so a typed 2.5 or 5 stays tidy.
export function raisedTarget(current: number | null, liftedWeight: number, step: number): number {
  const base = current != null ? current : liftedWeight;
  return Math.round((base + step) * 4) / 4;
}

// "8" becomes "9", "8-10" becomes "9-11". Anything that is not a plain number or a range (a time, "AMRAP") is left alone, and the caller says so.
export function bumpedReps(text: string | null, by: number): string | null {
  if (!text) return null;
  const t = text.trim();
  if (/^\d+$/.test(t)) return String(Number(t) + by);
  const range = t.match(/^(\d+)\s*[-–to]+\s*(\d+)$/i);
  if (range) return `${Number(range[1]) + by}-${Number(range[2]) + by}`;
  return null;
}

// Adds the drafted line to the exercise's coaching notes without replacing what is already there.
export function appendedNote(existing: string | null, draft: string): string {
  const add = draft.trim();
  if (!add) return existing ?? "";
  const base = (existing ?? "").trim();
  if (base.includes(add)) return base;
  return base ? `${base}\n${add}` : add;
}

// "+5", "5" and "+ 5" all mean 5; anything else is not a usable step.
export function parseStep(text: string): number | null {
  const n = Number(text.replace(/^\s*\+\s*/, "").trim());
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
}
