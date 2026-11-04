import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { slotConflict } from "@/lib/booking-slots";

// Only the open times on a client's day page (Ron, Nov 3: "it needs to only present the open times, the available times, and not all times"). A client can read only their own
// sessions, so every other client's session was invisible to their screen and its hour was offered, then refused ("That slot was just taken"). The coach's busy times for the day
// are read here on the server: start and end only (no names, nothing about who), across every group and organization, the same sessions the booking functions refuse on.
export type BusyRange = { id: string; start: Date; end: Date };

/** The coach's confirmed sessions and discovery calls overlapping [fromIso, toIso). [] when the read fails (the screen then offers as before; the server still refuses a taken time). */
export async function coachBusyRanges(coachId: string, fromIso: string, toIso: string): Promise<BusyRange[]> {
  try {
    const admin = createServiceRoleClient();
    const [sessions, calls] = await Promise.all([
      admin.from("bookings").select("id, start_at, end_at").eq("coach_id", coachId).eq("status", "confirmed").lt("start_at", toIso).gt("end_at", fromIso).limit(500),
      admin.from("discovery_bookings").select("id, start_at, end_at").eq("coach_id", coachId).eq("status", "confirmed").lt("start_at", toIso).gt("end_at", fromIso).limit(200),
    ]);
    const rows = (r: { data: unknown; error: unknown }, prefix: string) =>
      r.error ? [] : ((r.data ?? []) as { id: string; start_at: string; end_at: string }[]).map((b) => ({ id: `${prefix}${b.id}`, start: new Date(b.start_at), end: new Date(b.end_at) }));
    return [...rows(sessions, ""), ...rows(calls, "discovery:")];
  } catch {
    return [];
  }
}

/** The sessions a screen already read, plus the coach's other busy times, each once. */
export function withBusy(own: BusyRange[], busy: BusyRange[]): BusyRange[] {
  const seen = new Set(own.map((b) => b.id));
  return [...own, ...busy.filter((b) => !seen.has(b.id))];
}

/** The slots a client is offered: their own sessions, and the times clear of every other session (with the buffer). The session being moved does not count against itself. */
export function onlyOpenSlots<T extends { start: Date; durationMinutes: number }>(slots: T[], busy: BusyRange[], ownStarts: Set<number>, ignoreBookingId: string | null, bufferMinutes: number): T[] {
  const others = busy.filter((b) => b.id !== ignoreBookingId);
  return slots.filter((s) => ownStarts.has(s.start.getTime()) || slotConflict(s.start, new Date(s.start.getTime() + s.durationMinutes * 60000), others, bufferMinutes) === null);
}
