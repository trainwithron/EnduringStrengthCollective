import type { InboxConversation } from "@/lib/coach-inbox";

// A plain summary of the coach's messages, worked out from counts and times alone (nothing reads or summarises what a message says with an AI): how many clients are waiting for a
// reply, who has waited longest, how long, and the first line of what they wrote. "Waiting" means the newest message in the conversation is the client's.
export interface SynopsisItem {
  otherId: string;
  fullName: string;
  groupId: string;
  // "3 hours", "2 days": how long the client's newest message has been waiting.
  waited: string;
  waitedMs: number;
  firstLine: string;
  unread: number;
}

export interface MessagesSynopsis {
  // Oldest wait first.
  waiting: SynopsisItem[];
  waitingCount: number;
  unreadTotal: number;
  // One sentence for the top of the list.
  line: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIRST_LINE_MAX = 80;

export function waitedLabel(ms: number): string {
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / 60_000));
    return ms < 60_000 ? "just now" : `${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.floor(ms / DAY);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

// The first line of what they wrote, trimmed to a short length at a word.
export function firstLineOf(body: string | null | undefined): string {
  const line = (body ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (line.length <= FIRST_LINE_MAX) return line;
  const cut = line.slice(0, FIRST_LINE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function messagesSynopsis(conversations: InboxConversation[], now: Date): MessagesSynopsis {
  const waiting: SynopsisItem[] = conversations
    .filter((c) => c.lastFromOther && !!c.lastAt)
    .map((c) => {
      const waitedMs = Math.max(0, now.getTime() - new Date(c.lastAt as string).getTime());
      return { otherId: c.otherId, fullName: c.fullName, groupId: c.groupId, waited: waitedLabel(waitedMs), waitedMs, firstLine: firstLineOf(c.lastBody), unread: c.unreadCount };
    })
    .sort((a, b) => b.waitedMs - a.waitedMs || a.fullName.localeCompare(b.fullName));
  const unreadTotal = conversations.reduce((n, c) => n + c.unreadCount, 0);
  const hasAny = conversations.some((c) => !!c.lastAt);
  let line: string;
  if (waiting.length === 0) line = hasAny ? "Nobody is waiting for a reply." : "No messages yet.";
  else if (waiting.length === 1) line = `${waiting[0].fullName} is waiting for a reply (${waiting[0].waited}).`;
  else line = `${waiting.length} are waiting for a reply. The longest wait is ${waiting[0].fullName} (${waiting[0].waited}).`;
  return { waiting, waitingCount: waiting.length, unreadTotal, line };
}
