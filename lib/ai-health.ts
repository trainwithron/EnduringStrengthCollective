// The share of AI calls that did not finish well, per feature, over a window. A feature whose calls keep ending cut off ("truncated") or failing ("error") is a quiet outage the people using it feel long before anyone
// reads a log. "started" rows (a call still running, or one the server never heard back about) are left out. A feature needs a minimum number of calls before it can raise an alert, so one failure out of two does not.
export interface AiUsageRow {
  feature: string;
  status: string;
}

export interface AiFeatureHealth {
  feature: string;
  calls: number;
  notOk: number;
  share: number;
}

export const AI_ALERT_SHARE = 0.1;
export const AI_ALERT_MIN_CALLS = 10;

export function aiFeatureHealth(rows: AiUsageRow[]): AiFeatureHealth[] {
  const by = new Map<string, { calls: number; notOk: number }>();
  for (const r of rows) {
    if (r.status === "started") continue;
    const e = by.get(r.feature) ?? { calls: 0, notOk: 0 };
    e.calls++;
    if (r.status !== "ok") e.notOk++;
    by.set(r.feature, e);
  }
  return Array.from(by, ([feature, e]) => ({ feature, calls: e.calls, notOk: e.notOk, share: e.calls === 0 ? 0 : e.notOk / e.calls })).sort((a, b) => b.share - a.share);
}

export function aiFeaturesToAlert(health: AiFeatureHealth[]): AiFeatureHealth[] {
  return health.filter((h) => h.calls >= AI_ALERT_MIN_CALLS && h.share > AI_ALERT_SHARE);
}
