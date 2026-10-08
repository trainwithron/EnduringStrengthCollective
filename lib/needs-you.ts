// The "Needs you" strip at the top of a coach's Home: THREE fixed slots, each showing only the single most urgent thing of its kind, with one plain sentence, the client's name and one
// button. A slot with nothing shows nothing; when all three are empty the strip says "You're caught up." A small "N more" link opens the stack of panels below, which is unchanged.
// This file is the ranking only (no database): the data is gathered by lib/needs-you-data.ts from signals Home already works with.

export type NeedsYouSlot = "waiting" | "due" | "slipping";

export const SLOT_ORDER: NeedsYouSlot[] = ["waiting", "due", "slipping"];

export const SLOT_TITLE: Record<NeedsYouSlot, string> = {
  waiting: "Someone is waiting on you",
  due: "Something is due soon",
  slipping: "Someone may be slipping",
};

export const CAUGHT_UP = "You're caught up.";
export const COULD_NOT_CHECK = "I couldn't check everything just now. The panels below are still there.";

// What each kind of thing is, in the order it matters within its slot (first = most urgent).
export type NeedsYouKind =
  // waiting
  | "schedule_request"
  | "booking_request"
  | "client_message"
  | "group_reply"
  // due
  | "session_soon"
  | "late_change"
  | "payment"
  | "expiring_credits"
  // slipping
  | "injury"
  | "low_readiness"
  | "quiet_strong"
  | "quiet_mild";

export const KIND_SLOT: Record<NeedsYouKind, NeedsYouSlot> = {
  schedule_request: "waiting",
  booking_request: "waiting",
  client_message: "waiting",
  group_reply: "waiting",
  session_soon: "due",
  late_change: "due",
  payment: "due",
  expiring_credits: "due",
  injury: "slipping",
  low_readiness: "slipping",
  quiet_strong: "slipping",
  quiet_mild: "slipping",
};

export const KIND_ORDER: NeedsYouKind[] = [
  "schedule_request",
  "booking_request",
  "client_message",
  "group_reply",
  "session_soon",
  "late_change",
  "expiring_credits",
  "payment",
  "injury",
  "low_readiness",
  "quiet_strong",
  "quiet_mild",
];

export interface NeedsYouItem {
  // Unique and stable (the same thing never appears twice).
  id: string;
  kind: NeedsYouKind;
  // The client's name, or the group's when it is not about one client.
  name: string;
  // One plain sentence about it (no name in it: the card shows the name beside it).
  sentence: string;
  // The one button: its words and where it goes.
  button: string;
  href: string;
  // Within a kind, lower comes first (the one waiting longest, the one starting soonest). A millisecond time or any number.
  order: number;
}

export interface SlotView {
  slot: NeedsYouSlot;
  title: string;
  item: NeedsYouItem | null;
}

export interface NeedsYouView {
  slots: SlotView[];
  // Items beyond the ones shown (the "N more" link). Zero when every slot shows its only item or nothing.
  moreCount: number;
  // True only when nothing needs the coach AND every check was made.
  caughtUp: boolean;
  // Some check could not be made, so "nothing" may not be the whole truth: the strip says so instead of "You're caught up."
  incomplete: boolean;
}

const rankOf = (k: NeedsYouKind) => KIND_ORDER.indexOf(k);

export function pickNeedsYou(items: NeedsYouItem[], opts: { incomplete?: boolean } = {}): NeedsYouView {
  // The same thing never appears twice.
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const sorted = [...unique].sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || a.order - b.order || a.id.localeCompare(b.id));
  const slots: SlotView[] = SLOT_ORDER.map((slot) => ({ slot, title: SLOT_TITLE[slot], item: sorted.find((i) => KIND_SLOT[i.kind] === slot) ?? null }));
  const shown = slots.filter((s) => s.item).length;
  const incomplete = !!opts.incomplete;
  return { slots, moreCount: Math.max(0, unique.length - shown), caughtUp: unique.length === 0 && !incomplete, incomplete };
}

// "N more" wording.
export const moreLabel = (n: number): string => `${n} more`;

// ---- the sentences (kept here so they read the same everywhere and can be tested) -------------------------------------------------

const SCHEDULE_VERB: Record<string, string> = { pause: "pause", freeze: "freeze", cancel: "cancel" };

export const sentences = {
  scheduleRequest: (kind: string) => `Asked to ${SCHEDULE_VERB[kind] ?? "change"} their recurring sessions.`,
  bookingRequest: () => "Asked to move a session.",
  clientMessage: (count: number) => (count > 1 ? `Sent you ${count} messages you haven't read.` : "Sent you a message you haven't read."),
  groupReply: (groupName: string) => `Is waiting for a reply in ${groupName}.`,
  sessionSoon: (timeLabel: string) => `Session starts at ${timeLabel}.`,
  lateChange: () => "Changed a session late. Decide whether to charge it.",
  payment: (balance: number) => (balance < 0 ? `Is out of sessions (owed ${Math.abs(balance)}).` : "Is out of sessions."),
  expiringCredits: (daysLeft: number) => (daysLeft <= 0 ? "Has sessions that expire today." : daysLeft === 1 ? "Has sessions that expire tomorrow." : `Has sessions that expire in ${daysLeft} days.`),
  injury: () => "Is marked injured.",
  lowReadiness: () => "Checked in low on readiness today.",
  quietStrong: () => "Has gone quiet. Worth a personal check-in.",
  quietMild: () => "Hasn't logged in a while.",
};

export const BUTTON = {
  review: "Review",
  reply: "Reply",
  open: "Open",
  decide: "Decide",
  checkIn: "Check in",
} as const;
