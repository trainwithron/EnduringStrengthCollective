// Which days (or exercises) are collapsed in the program builder (pure). Every item is independent: opening one never closes another, so Day 1 and Day 2 can stay open while Day 3 is built.
// The state is only what is on screen right now: it is not saved, and everything starts open.

export type CollapsedSet = ReadonlySet<string>;

export const NONE_COLLAPSED: CollapsedSet = new Set();

// Flips one item and leaves every other as it was.
export function toggleCollapsed(collapsed: CollapsedSet, id: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function collapseAll(ids: string[]): Set<string> {
  return new Set(ids);
}

export function expandAll(): Set<string> {
  return new Set();
}

// True when there is something to collapse and all of it already is: the button then offers "Expand all".
export function allCollapsed(collapsed: CollapsedSet, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => collapsed.has(id));
}

// What the single "Collapse all / Expand all" button does next.
export function toggleAll(collapsed: CollapsedSet, ids: string[]): Set<string> {
  return allCollapsed(collapsed, ids) ? expandAll() : collapseAll(ids);
}
