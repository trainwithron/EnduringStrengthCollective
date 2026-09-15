// Hover rail widgets (hover_expand_rail_widgets_idea.md) — the Business
// icon's popover shows the coach's own top-3 picked metrics, not a fixed
// dashboard. This resolves a saved pick list down to exactly 3 valid
// keys, same show/hide-adjacent shape as lib/spot-widgets.ts's
// computeVisibleSpotWidgetOrder but simpler (a fixed-size pick, not an
// orderable/hideable set) — kept as its own small function since the two
// surfaces' selection rules differ (exactly 3, always, vs. hide-any-many).

export type BusinessMetricKey =
  | "mrr"
  | "new_clients_month"
  | "active_paying"
  | "income_month"
  | "roster_size"
  | "engagement_pct";

export const BUSINESS_METRIC_LABELS: Record<BusinessMetricKey, string> = {
  mrr: "MRR",
  new_clients_month: "New clients (mo)",
  active_paying: "Active paying",
  income_month: "Income this month",
  roster_size: "Roster size",
  engagement_pct: "Engagement",
};

export const ALL_BUSINESS_METRIC_KEYS: BusinessMetricKey[] = [
  "mrr",
  "new_clients_month",
  "active_paying",
  "income_month",
  "roster_size",
  "engagement_pct",
];

export const DEFAULT_BUSINESS_METRICS: BusinessMetricKey[] = ["mrr", "new_clients_month", "active_paying"];

// A saved pick might contain a stale/unknown key (a metric renamed or
// removed after a coach already saved their pick) or fewer/more than 3 —
// resolve down to exactly 3 valid keys, falling back to the default set
// to fill any gap, same "never silently drop below a sane baseline"
// principle as the Spot's own widget-order resolver.
export function resolveTopBusinessMetrics(saved: string[]): BusinessMetricKey[] {
  const known = new Set(ALL_BUSINESS_METRIC_KEYS as readonly string[]);
  const valid = saved.filter((key, i) => known.has(key) && saved.indexOf(key) === i) as BusinessMetricKey[];
  const result = [...valid];
  for (const fallback of DEFAULT_BUSINESS_METRICS) {
    if (result.length >= 3) break;
    if (!result.includes(fallback)) result.push(fallback);
  }
  for (const key of ALL_BUSINESS_METRIC_KEYS) {
    if (result.length >= 3) break;
    if (!result.includes(key)) result.push(key);
  }
  return result.slice(0, 3);
}
