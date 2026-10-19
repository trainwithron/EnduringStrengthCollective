import type { ClientTierLite } from "@/lib/session-type-default";

// How a client works with the coach, for booking: In person (stored as the client's tier "one_on_one"), Online, or Group. The type is the tier the coach sets on the client (group_memberships.client_tier,
// the same value the Clients filters read); a client with no tier in a one-on-one space counts as In person.
// Where clients are offered for booking (the calendar's client list, the phone's "Calendar for" list) Online clients are left out until the coach asks for them with one small toggle, and
// clients set aside stay out as before. A client who is already picked always stays in the list, so the screen never loses the person it is showing.

export type ClientType = "one_on_one" | "online" | "group";

export const CLIENT_TYPE_CHOICES: { value: ClientType; label: string }[] = [
  { value: "one_on_one", label: "In person" },
  { value: "online", label: "Online" },
  { value: "group", label: "Group" },
];

export const SHOW_ONLINE_KEY = "calendar-show-online-clients";

export const isOnlineClient = (tier: ClientTierLite): boolean => tier === "online";

export function offeredForBooking<T>(
  clients: T[],
  opts: { tierOf: (c: T) => ClientTierLite; isSetAside?: (c: T) => boolean; showOnline: boolean; showSetAside?: boolean; keep?: (c: T) => boolean }
): T[] {
  return clients.filter((c) => {
    if (opts.keep?.(c)) return true;
    if (!opts.showSetAside && opts.isSetAside?.(c)) return false;
    if (!opts.showOnline && isOnlineClient(opts.tierOf(c))) return false;
    return true;
  });
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Kept in this browser only (a per-device preference), and always safe to read: private windows and blocked storage throw, so any failure just means "hidden" (the default).
export function readShowOnline(storage: StorageLike | null | undefined): boolean {
  try {
    return storage?.getItem(SHOW_ONLINE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowOnline(storage: StorageLike | null | undefined, show: boolean): void {
  try {
    storage?.setItem(SHOW_ONLINE_KEY, show ? "1" : "0");
  } catch {
    // the choice still applies for this visit; it just is not remembered
  }
}
