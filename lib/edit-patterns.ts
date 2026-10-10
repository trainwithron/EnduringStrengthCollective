// Notices a change the coach keeps making to AI drafts, so the app can ask about it ONCE. Pure; no database.
//
// A pattern is "when the AI wrote <from>, the coach changed it to <to>". It is only worth asking about when it has happened in enough programs (MIN_PROGRAMS) AND in
// most of the programs that had <from> at all (MIN_SHARE). Programs counted are the coach's most recent signed-off AI programs (LAST_PROGRAMS).

export const LAST_PROGRAMS = 10;
export const MIN_PROGRAMS = 5;
export const MIN_SHARE = 0.7;

export interface SignoffLite {
  programId: string;
  exercises: string[];
}

export interface SwapEventLite {
  programId: string;
  from: string;
  to: string;
}

export interface SwapPattern {
  from: string;
  to: string;
  // Programs where the coach made this change, and programs in the window that had the exercise at all.
  count: number;
  total: number;
}

const k = (s: string) => s.trim().toLowerCase();
export const patternKey = (from: string, to: string) => `${k(from)}|${k(to)}`;

// `signoffs` newest first. `alreadyAsked` holds patternKey()s that were asked about before (confirmed, declined, undone or just shown): never asked twice.
export function detectSwapPatterns(signoffs: SignoffLite[], events: SwapEventLite[], alreadyAsked: Set<string>): SwapPattern[] {
  const window = signoffs.slice(0, LAST_PROGRAMS);
  const ids = new Set(window.map((s) => s.programId));
  const byPair = new Map<string, { from: string; to: string; programs: Set<string> }>();
  for (const e of events) {
    if (!ids.has(e.programId) || k(e.from) === k(e.to)) continue;
    const pk = patternKey(e.from, e.to);
    const entry = byPair.get(pk) ?? { from: e.from, to: e.to, programs: new Set<string>() };
    entry.programs.add(e.programId);
    byPair.set(pk, entry);
  }
  const out: SwapPattern[] = [];
  for (const [pk, e] of byPair) {
    if (alreadyAsked.has(pk)) continue;
    const total = window.filter((s) => s.exercises.some((x) => k(x) === k(e.from))).length;
    const count = e.programs.size;
    if (count >= MIN_PROGRAMS && total > 0 && count / total >= MIN_SHARE) out.push({ from: e.from, to: e.to, count, total });
  }
  // The strongest first (most programs, then the highest share).
  return out.sort((a, b) => b.count - a.count || b.count / b.total - a.count / a.total);
}

// "I'm asking less": the questions asked per signed-off program (oldest first) have fallen. Needs at least six programs so it never claims it early.
export function askingLessThanBefore(questionsOldestFirst: number[]): boolean {
  if (questionsOldestFirst.length < 6) return false;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return avg(questionsOldestFirst.slice(-3)) < avg(questionsOldestFirst.slice(0, 3));
}

export function suggestionText(p: SwapPattern): string {
  return `In ${p.count} of your last ${p.total} programs with ${p.from}, you changed it to ${p.to}. Use ${p.to} instead from now on?`;
}

// The line saved into the coach's standing preferences (read by the builder with every other one) when the coach says Yes.
export function preferenceFor(p: { from: string; to: string }): { condition: string; preference: string } {
  return { condition: "writing any program", preference: `Use ${p.to} instead of ${p.from}.` };
}
