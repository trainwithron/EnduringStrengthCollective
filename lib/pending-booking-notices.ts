// A booking made from the calendar is only announced to the client (push, text, calendar mirror) once its few seconds of Undo have passed. If the tab is closed
// or refreshed inside that window, or the browser dies, the announcement would be lost and the booking would be silent. So it is written down here first, and any
// coach page that opens later sends what is due (only for bookings that are still confirmed and still ahead, so an undone one never sends anything). One that has
// waited a long time is not sent on its own: the coach is asked.

export interface PendingNotice {
  bookingId: string;
  // The coach who made it: on a shared browser each coach only ever sends their own.
  coachId: string;
  athleteId: string;
  groupId: string;
  startIso: string;
  // When the booking was made (ms).
  madeAt: number;
}

const KEY = "esc.pendingBookingNotices.v2";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function listPending(store: KeyValueStore | null = defaultStore()): PendingNotice[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n) =>
        n &&
        typeof n.bookingId === "string" &&
        typeof n.coachId === "string" &&
        typeof n.athleteId === "string" &&
        typeof n.groupId === "string" &&
        typeof n.startIso === "string" &&
        typeof n.madeAt === "number"
    );
  } catch {
    return [];
  }
}

function save(list: PendingNotice[], store: KeyValueStore | null) {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // Storage full or blocked: the in-page timer still announces it.
  }
}

export function addPending(notice: PendingNotice, store: KeyValueStore | null = defaultStore()) {
  const list = listPending(store).filter((n) => n.bookingId !== notice.bookingId);
  list.push(notice);
  save(list, store);
}

export function removePending(bookingId: string, store: KeyValueStore | null = defaultStore()) {
  save(listPending(store).filter((n) => n.bookingId !== bookingId), store);
}

// The coach's own notices whose Undo time has passed.
export function dueNotices(list: PendingNotice[], coachId: string, now: number, windowMs: number): PendingNotice[] {
  return list.filter((n) => n.coachId === coachId && now - n.madeAt >= windowMs);
}

// After this long a notice is not sent on its own any more: "your session is confirmed" hours later is news the coach should choose to send.
export const AUTO_SEND_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isStale(n: PendingNotice, now: number): boolean {
  return now - n.madeAt > AUTO_SEND_MAX_AGE_MS;
}
