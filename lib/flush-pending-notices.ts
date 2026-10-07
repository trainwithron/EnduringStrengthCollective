import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyBookingConfirmed } from "./notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "./mirror-google-calendar-event";
import { dueNotices, expiredNotices, listPending, removePending } from "./pending-booking-notices";

// Sends the announcements a closed or refreshed tab never got to (see pending-booking-notices.ts), when any calendar page opens. Only a booking that is still
// confirmed is announced; one that was undone or cancelled since is dropped silently. Runs once per page load and never throws.
export const FLUSH_AFTER_MS = 15000;

export async function flushDueNotices(supabase: SupabaseClient, now: number = Date.now()): Promise<number> {
  try {
    const all = listPending();
    for (const old of expiredNotices(all, now)) removePending(old.bookingId);
    const due = dueNotices(
      all.filter((n) => !expiredNotices(all, now).includes(n)),
      now,
      FLUSH_AFTER_MS
    );
    if (due.length === 0) return 0;
    const { data, error } = await supabase.from("bookings").select("id, status").in("id", due.map((n) => n.bookingId));
    if (error) return 0;
    const confirmed = new Set(((data ?? []) as { id: string; status: string }[]).filter((b) => b.status === "confirmed").map((b) => b.id));
    let sent = 0;
    for (const n of due) {
      // Taken off the list first: if another tab is flushing too, whoever removes it first is the one that sends.
      removePending(n.bookingId);
      if (!confirmed.has(n.bookingId)) continue;
      notifyBookingConfirmed(n.athleteId, n.groupId, n.startIso);
      mirrorGoogleCalendarEvent(n.bookingId);
      sent += 1;
    }
    return sent;
  } catch {
    return 0;
  }
}
