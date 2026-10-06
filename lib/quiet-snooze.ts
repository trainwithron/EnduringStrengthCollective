// Home's "need attention" clients (the quiet-client flags) can be snoozed one by one or all at once. A snooze is a Spotter feedback row (the coach said
// "not now"), so nothing new is stored and nothing is lost: the client simply stops being flagged for a week, and is flagged again if still quiet then.

export const QUIET_SNOOZE_DAYS = 7;
export const QUIET_SNOOZE_KIND = "quiet_client";

export function quietSnoozeKey(athleteId: string, groupId: string): string {
  return `quiet::${athleteId}::${groupId}`;
}

// The keys still snoozed at `now`, from the coach's recent feedback rows (any order).
export function snoozedQuietKeys(rows: { dismissal_key: string; created_at: string }[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.dismissal_key.startsWith("quiet::")) continue;
    if (now.getTime() - new Date(r.created_at).getTime() < QUIET_SNOOZE_DAYS * 86400000) out.add(r.dismissal_key);
  }
  return out;
}
