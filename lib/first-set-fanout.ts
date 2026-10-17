// Typing the first set's value and moving on fills the other sets in that row too (3 sets of 5 need no "5" typed three times). But only the sets that are still empty, or still hold the first set's OLD value,
// follow it: a set the coach already gave its own number (a heavier top set) is never overwritten by it.
export function firstSetFollowers<T extends { id: string }>(sets: T[], firstId: string, keys: Array<keyof T>): string[] {
  const first = sets.find((s) => s.id === firstId);
  return sets
    .filter((s) => s.id !== firstId)
    .filter((s) => keys.every((k) => s[k] === null || s[k] === undefined || (s[k] as unknown) === "" || (first != null && s[k] === first[k])))
    .map((s) => s.id);
}
