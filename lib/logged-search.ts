// Search for a client's Logged workouts (release CC): by exercise name or part of a date, and between two dates. Pure; the profile page reads the three search words from the address and filters the
// list it already has. The exercise names of a workout come from the rolled-up counted sets, so a workout is found by any exercise in it.

export interface LoggedSearchWords {
  q: string;
  from: string;
  to: string;
}

export interface SearchableWorkout {
  sessionId: string | null;
  dateKey: string; // YYYY-MM-DD in the coach's zone
}

// A date typed or picked as YYYY-MM-DD; anything else is ignored rather than guessed at.
export function cleanDateWord(raw: string | undefined | null): string {
  const text = (raw ?? "").trim();
  if (text.length !== 10 || text[4] !== "-" || text[7] !== "-") return "";
  return Number.isFinite(Date.parse(text + "T00:00:00Z")) ? text : "";
}

export function readSearchWords(params: { q?: string; from?: string; to?: string } | undefined): LoggedSearchWords {
  return { q: (params?.q ?? "").trim().slice(0, 80), from: cleanDateWord(params?.from), to: cleanDateWord(params?.to) };
}

export function isSearching(words: LoggedSearchWords): boolean {
  return words.q !== "" || words.from !== "" || words.to !== "";
}

export function matchesLoggedSearch(item: SearchableWorkout, namesBySession: Map<string, string[]>, words: LoggedSearchWords): boolean {
  if (words.from && item.dateKey < words.from) return false;
  if (words.to && item.dateKey > words.to) return false;
  const q = words.q.toLowerCase();
  if (!q) return true;
  if (item.dateKey.includes(q)) return true;
  const names = item.sessionId ? namesBySession.get(item.sessionId) ?? [] : [];
  return names.some((name) => name.toLowerCase().includes(q));
}

export function namesBySessionFrom(rows: { sessionId: string; exerciseName: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.sessionId) ?? [];
    list.push(r.exerciseName);
    out.set(r.sessionId, list);
  }
  return out;
}
