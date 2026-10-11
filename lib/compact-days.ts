// Which days of a week the coach has switched to the compact view. Remembered in this browser, per program and week, and never saved to the program itself.
// A new day is not compact until it is switched.

export const compactKey = (programId: string, weekNumber: number) => `builder-compact:${programId}:${weekNumber}`;

export function parseCompact(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function serializeCompact(ids: Set<string>): string {
  return JSON.stringify([...ids]);
}

export function toggleDay(ids: Set<string>, dayId: string): Set<string> {
  const next = new Set(ids);
  if (next.has(dayId)) next.delete(dayId);
  else next.add(dayId);
  return next;
}

// The week's "Compact view" button: if every day is already compact, all go back to full; otherwise all become compact.
export function toggleWeek(ids: Set<string>, dayIds: string[]): Set<string> {
  if (dayIds.length > 0 && dayIds.every((id) => ids.has(id))) {
    const next = new Set(ids);
    for (const id of dayIds) next.delete(id);
    return next;
  }
  const next = new Set(ids);
  for (const id of dayIds) next.add(id);
  return next;
}

export function readCompact(storage: Pick<Storage, "getItem"> | null, programId: string, weekNumber: number): Set<string> {
  try {
    return parseCompact(storage?.getItem(compactKey(programId, weekNumber)));
  } catch {
    return new Set();
  }
}

export function writeCompact(storage: Pick<Storage, "setItem"> | null, programId: string, weekNumber: number, ids: Set<string>): void {
  try {
    storage?.setItem(compactKey(programId, weekNumber), serializeCompact(ids));
  } catch {
    // Private mode or a full store: the view still works for this visit, it just is not remembered.
  }
}
