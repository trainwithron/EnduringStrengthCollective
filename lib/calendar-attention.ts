import { QUIET_SNOOZE_KIND, quietSnoozeKey } from "./quiet-snooze";
import { QUIET_TIER_LABEL } from "./quiet-client-tier";

// The calendar's "Needs attention" list, as plain rows the coach can snooze one by one or all together. Quiet-client rows use the SAME snooze key as Home's
// Client Pulse (so snoozing a client in either place quiets both); program rows get their own key. A snooze is a feedback row (the coach said "not now"),
// so nothing new is stored and nothing is lost: the item comes back after the snooze if it is still true.

export const CALENDAR_ATTENTION_KIND = "calendar_attention";
export const CALENDAR_ATTENTION_SNOOZE_DAYS = 7;

export interface AttentionItem {
  key: string;
  label: string;
  href: string;
  // Which feedback kind records the snooze for this row.
  snoozeKind: string;
  // Who or what it is about, for the feedback row's summary.
  subject: string;
}

export const programAttentionKey = (kind: "empty" | "schedule" | "noprogram", id: string) => `calattn::${kind}::${id}`;

// A client who has never done a workout has not "gone quiet": they have not started. The label says so.
export function quietLabel(tier: "mild" | "strong", neverLogged: boolean): string {
  return neverLogged ? "hasn't done a first workout yet" : QUIET_TIER_LABEL[tier];
}

export function buildAttentionItems(input: {
  groupId: string;
  programsWithNoWorkouts: { id: string; name: string; athleteName: string | null }[];
  programsMissingSchedule: { id: string; name: string; athleteName: string | null }[];
  clientsWithNoProgram: { profileId: string; fullName: string; groupId: string }[];
  quietClients: { profileId: string; fullName: string; groupId: string; tier: "mild" | "strong"; neverLogged: boolean }[];
}): AttentionItem[] {
  const { groupId } = input;
  const items: AttentionItem[] = [];
  const who = (n: string | null) => (n ? ` (${n})` : "");
  for (const p of input.programsWithNoWorkouts) {
    items.push({
      key: programAttentionKey("empty", p.id),
      label: `“${p.name}”${who(p.athleteName)} has no workouts built yet`,
      href: `/groups/${groupId}/programs/${p.id}`,
      snoozeKind: CALENDAR_ATTENTION_KIND,
      subject: p.name,
    });
  }
  for (const p of input.programsMissingSchedule) {
    items.push({
      key: programAttentionKey("schedule", p.id),
      label: `“${p.name}”${who(p.athleteName)} needs a start date to show on the calendar`,
      href: `/groups/${groupId}/programs/${p.id}`,
      snoozeKind: CALENDAR_ATTENTION_KIND,
      subject: p.name,
    });
  }
  for (const c of input.clientsWithNoProgram) {
    items.push({
      key: programAttentionKey("noprogram", `${c.profileId}::${c.groupId}`),
      label: `${c.fullName} has no program assigned`,
      href: `/groups/${c.groupId}/athletes/${c.profileId}`,
      snoozeKind: CALENDAR_ATTENTION_KIND,
      subject: c.fullName,
    });
  }
  for (const c of input.quietClients) {
    items.push({
      key: quietSnoozeKey(c.profileId, c.groupId),
      label: `${c.fullName} ${quietLabel(c.tier, c.neverLogged)}`,
      href: `/groups/${c.groupId}/athletes/${c.profileId}`,
      snoozeKind: QUIET_SNOOZE_KIND,
      subject: c.fullName,
    });
  }
  return items;
}

// What is left after the snoozes.
export function visibleAttention(items: AttentionItem[], snoozed: Set<string>): AttentionItem[] {
  return items.filter((i) => !snoozed.has(i.key));
}

// The rows to insert to snooze these items (one feedback row each).
export function snoozeRows(coachId: string, items: AttentionItem[]) {
  return items.map((i) => ({
    coach_id: coachId,
    spotter_kind: i.snoozeKind,
    dismissal_key: i.key,
    option_summary: `${i.subject}: needs attention, snoozed ${CALENDAR_ATTENTION_SNOOZE_DAYS} days`.slice(0, 200),
    action: "denied" as const,
  }));
}

// The keys still snoozed at `now`: Home's quiet-client snoozes and this list's own, from the coach's recent feedback rows (any order).
export function snoozedAttentionKeys(rows: { dismissal_key: string; created_at: string }[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.dismissal_key.startsWith("quiet::") && !r.dismissal_key.startsWith("calattn::")) continue;
    if (now.getTime() - new Date(r.created_at).getTime() < CALENDAR_ATTENTION_SNOOZE_DAYS * 86400000) out.add(r.dismissal_key);
  }
  return out;
}

// Three at a time, in the order given.
export function attentionPage(items: AttentionItem[], page: number, size = 3): { shown: AttentionItem[]; remaining: number } {
  const shown = items.slice(0, (page + 1) * size);
  return { shown, remaining: Math.max(0, items.length - shown.length) };
}
