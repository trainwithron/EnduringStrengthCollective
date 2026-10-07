// A booking made from the calendar is only announced to the client (push, text, calendar mirror) once its few seconds of Undo have passed. If the tab is closed
// or refreshed inside that window, or the browser dies, the announcement would be lost and the booking would be silent. So it is written down here first, and any
// calendar page that opens later sends what is due (only for bookings that are still confirmed, so an undone one never sends anything).

export interface PendingNotice {
  bookingId: string;
  athleteId: string;
  groupId: string;
  startIso: string;
  // When the booking was made (ms).
  madeAt: number;
}

const KEY = "esc.pendingBookingNotices.v1";

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
    return parsed.filter((n) => n && typeof n.bookingId === "string" && typeof n.athleteId === "string" && typeof n.groupId === "string" && typeof n.startIso === "string" && typeof n.madeAt === "number");
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

// The ones whose Undo time has passed.
export function dueNotices(list: PendingNotice[], now: number, windowMs: number): PendingNotice[] {
  return list.filter((n) => now - n.madeAt >= windowMs);
}

// A notice older than this is dropped without sending: it is no longer news (a session announced days late is worse than none).
export const NOTICE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function expiredNotices(list: PendingNotice[], now: number): PendingNotice[] {
  return list.filter((n) => now - n.madeAt > NOTICE_MAX_AGE_MS);
}
