// "The Spot" (coach_only_widget_hub_the_spot.md) — the coach-only widget
// rail shown on top of the true-mirror View-As-Client screen. Same
// show/hide/reorder shape as the Home dashboard's own tiles
// (lib/dashboard-layout.ts's computeVisibleTileOrder), just a second,
// independent key set for a different customizable surface — kept as
// its own small function rather than generalizing that one, since the
// two surfaces' default orders and key sets are unrelated and a shared
// generic would need a type parameter for no real benefit here.

export const DEFAULT_SPOT_WIDGET_ORDER = ["credits", "waiver", "support"] as const;
export type SpotWidgetKey = (typeof DEFAULT_SPOT_WIDGET_ORDER)[number];

export function computeVisibleSpotWidgetOrder(savedOrder: string[], hidden: string[]): SpotWidgetKey[] {
  const hiddenSet = new Set(hidden);
  const known = new Set(DEFAULT_SPOT_WIDGET_ORDER as readonly string[]);

  const base = savedOrder.length > 0 ? savedOrder : [...DEFAULT_SPOT_WIDGET_ORDER];
  const ordered: string[] = [];
  for (const key of base) {
    if (known.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of DEFAULT_SPOT_WIDGET_ORDER) {
    if (!ordered.includes(key)) ordered.push(key);
  }

  return ordered.filter((key) => !hiddenSet.has(key)) as SpotWidgetKey[];
}
