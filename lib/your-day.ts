// The top of a coach's Home: what is on the schedule today, and one ranked list of what needs them, merged from the signals that used to sit in
// separate panels (replies waiting, clients out of sessions, low readiness today, the day's insights, notices). The separate panels stay
// below for acting on each; this is the one place to look first.

export type AttentionKind = "reply" | "payment" | "readiness" | "insight" | "notice";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  text: string;
  detail: string | null;
  href: string;
  urgency: 1 | 2 | 3; // 3 = today matters
  at: string | null; // ISO, newest first among equals
}

export interface ReplySource { postId: string; groupId: string; groupName: string; channel: string; authorName: string; snippet: string }
export interface PaymentSource { athleteId: string; groupId: string; name: string; balance: number }
export interface ReadinessSource { athleteId: string; groupId: string; name: string }
export interface InsightSource { id: string; headline: string; athleteId: string; groupId: string }
export interface NoticeSource { id: string; body: string; linkPath: string; createdAt: string }

export const KIND_LABEL: Record<AttentionKind, string> = {
  reply: "Reply",
  payment: "Sessions",
  readiness: "Readiness",
  insight: "Insight",
  notice: "Notice",
};

const KIND_ORDER: AttentionKind[] = ["readiness", "payment", "reply", "insight", "notice"];

export function attentionFromSources(src: {
  replies?: ReplySource[];
  payments?: PaymentSource[];
  readiness?: ReadinessSource[];
  insights?: InsightSource[];
  notices?: NoticeSource[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of src.replies ?? []) {
    items.push({
      id: `reply:${r.postId}`,
      kind: "reply",
      text: `${r.authorName} is waiting for a reply in ${r.groupName}`,
      detail: r.snippet ? r.snippet : null,
      href: `/groups/${r.groupId}/feed?channel=${r.channel}&highlight=${r.postId}`,
      urgency: 2,
      at: null,
    });
  }
  for (const p of src.payments ?? []) {
    items.push({
      id: `payment:${p.athleteId}:${p.groupId}`,
      kind: "payment",
      text: p.balance < 0 ? `${p.name} is out of sessions (owed ${Math.abs(p.balance)})` : `${p.name} is out of sessions`,
      detail: null,
      href: `/groups/${p.groupId}/athletes/${p.athleteId}`,
      // Having taken sessions already (negative) is more pressing than just reaching zero.
      urgency: p.balance < 0 ? 3 : 2,
      at: null,
    });
  }
  for (const r of src.readiness ?? []) {
    items.push({
      id: `readiness:${r.athleteId}:${r.groupId}`,
      kind: "readiness",
      text: `${r.name} checked in low on readiness today`,
      detail: null,
      href: `/groups/${r.groupId}/athletes/${r.athleteId}`,
      urgency: 3,
      at: null,
    });
  }
  for (const i of src.insights ?? []) {
    items.push({
      id: `insight:${i.id}`,
      kind: "insight",
      text: i.headline,
      detail: null,
      href: `/groups/${i.groupId}/athletes/${i.athleteId}`,
      urgency: 1,
      at: null,
    });
  }
  for (const n of src.notices ?? []) {
    items.push({ id: `notice:${n.id}`, kind: "notice", text: n.body, detail: null, href: n.linkPath, urgency: 1, at: n.createdAt });
  }
  // The same thing never appears twice.
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export function rankAttention(items: AttentionItem[], limit = 6): { shown: AttentionItem[]; hidden: number } {
  const sorted = [...items].sort((a, b) => {
    if (a.urgency !== b.urgency) return b.urgency - a.urgency;
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? 1 : -1;
    return 0;
  });
  return { shown: sorted.slice(0, limit), hidden: Math.max(0, sorted.length - limit) };
}

export function attentionCounts(items: AttentionItem[]): Partial<Record<AttentionKind, number>> {
  const out: Partial<Record<AttentionKind, number>> = {};
  for (const i of items) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}

// "3 need you" / "Nothing needs you right now".
export function attentionHeadline(total: number): string {
  if (total === 0) return "Nothing needs you right now";
  return total === 1 ? "1 thing needs you" : `${total} things need you`;
}

// ---- the day's schedule ---------------------------------------------------------------------------------------------------------

export interface ScheduleEntry {
  id: string;
  kind: "session" | "class";
  title: string;
  detail: string;
  startAt: string;
  endAt: string | null;
  href: string;
  needsPayment: boolean;
}

export interface BookingSource { id: string; athleteId: string; groupId: string; athleteName: string; groupName: string; startAt: string; needsPayment: boolean }
export interface ClassSource { id: string; title: string; startAt: string; endAt: string; capacity: number; joined: number; waitlisted: number; groupId: string }

// Both kinds in time order. A class's hidden anchor booking is the coach's own booking, never a client's, and is dropped here so the
// class is not listed twice (or listed as the coach being their own client).
export function buildSchedule(coachId: string, bookings: BookingSource[], classes: ClassSource[]): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const b of bookings) {
    if (b.athleteId === coachId) continue;
    entries.push({
      id: `booking:${b.id}`,
      kind: "session",
      title: b.athleteName,
      detail: b.groupName,
      startAt: b.startAt,
      endAt: null,
      href: `/groups/${b.groupId}/athletes/${b.athleteId}`,
      needsPayment: b.needsPayment,
    });
  }
  for (const c of classes) {
    const spots = `${c.joined} of ${c.capacity} spots taken`;
    entries.push({
      id: `class:${c.id}`,
      kind: "class",
      title: c.title,
      detail: c.waitlisted > 0 ? `${spots}, ${c.waitlisted} waiting` : spots,
      startAt: c.startAt,
      endAt: c.endAt,
      href: `/groups/${c.groupId}/group-sessions`,
      needsPayment: false,
    });
  }
  return entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
