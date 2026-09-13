// Home dashboard tile show/hide/reorder (coach_dashboard_redesign_scoping.md)
// — Android widget-drawer philosophy: ships in this exact order with
// zero configuration; a coach who never touches it sees no difference.
// The hero row (Right Now + Team Pulse) is never included here at all —
// it's the one non-negotiable core of the page.

export const DEFAULT_TILE_ORDER = ["stats", "week", "today", "roster"] as const;
export type DashboardTileKey = (typeof DEFAULT_TILE_ORDER)[number];

// Computes the final visible, ordered tile list from a coach's saved
// preference. A tile added to the app after a coach already saved a
// layout (so it's absent from their stored `order`) still appears —
// appended at the end, not silently dropped — and only genuinely hidden
// tiles are removed.
export function computeVisibleTileOrder(savedOrder: string[], hidden: string[]): DashboardTileKey[] {
  const hiddenSet = new Set(hidden);
  const known = new Set(DEFAULT_TILE_ORDER as readonly string[]);

  const base = savedOrder.length > 0 ? savedOrder : [...DEFAULT_TILE_ORDER];
  const ordered: string[] = [];
  for (const key of base) {
    if (known.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of DEFAULT_TILE_ORDER) {
    if (!ordered.includes(key)) ordered.push(key);
  }

  return ordered.filter((key) => !hiddenSet.has(key)) as DashboardTileKey[];
}
