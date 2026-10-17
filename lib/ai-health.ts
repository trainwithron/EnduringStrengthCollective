// The share of AI calls that did not finish well, per feature, over a window. A feature whose calls keep ending cut off ("truncated") or failing ("error") is a quiet outage the people using it feel long before anyone
// reads a log. "started" rows (a call still running, or one the server never heard back about) are left out. A feature needs a minimum number of calls before it can raise an alert, so one failure out of two does not.
// A cut-off call that the automatic retry then finished (same feature, same person, moments later) is not a failure the person saw, so that cut-off row is left out of the count.
export interface AiUsageRow {
  feature: string;
  status: string;
  created_at?: string;
  user_id?: string | null;
  coach_id?: string | null;
}

// How soon after a cut-off call its retry is logged (the retry runs straight away; the margin covers a slow second call).
export const AI_RETRY_HEAL_SECONDS = 180;

const actorOf = (r: AiUsageRow): string | null => r.user_id ?? r.coach_id ?? null;

// The cut-off rows whose retry finished: a "truncated" row followed by an "ok" row for the same feature and the same person within AI_RETRY_HEAL_SECONDS.
function healedTruncations(rows: AiUsageRow[]): Set<AiUsageRow> {
  const healed = new Set<AiUsageRow>();
  const okByKey = new Map<string, number[]>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.created_at) continue;
    const actor = actorOf(r);
    if (!actor) continue;
    const key = `${r.feature}|${actor}`;
    const list = okByKey.get(key) ?? [];
    list.push(new Date(r.created_at).getTime());
    okByKey.set(key, list);
  }
  for (const r of rows) {
    if (r.status !== "truncated" || !r.created_at) continue;
    const actor = actorOf(r);
    if (!actor) continue;
    const at = new Date(r.created_at).getTime();
    const oks = okByKey.get(`${r.feature}|${actor}`) ?? [];
    if (oks.some((t) => t >= at && t - at <= AI_RETRY_HEAL_SECONDS * 1000)) healed.add(r);
  }
  return healed;
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
  const healed = healedTruncations(rows);
  for (const r of rows) {
    if (r.status === "started" || healed.has(r)) continue;
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
