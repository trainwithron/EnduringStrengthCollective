import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyBookingConfirmed } from "./notify-booking-confirmed";
import { mirrorGoogleCalendarEvent } from "./mirror-google-calendar-event";
import { dueNotices, isStale, listPending, removePending, type PendingNotice } from "./pending-booking-notices";

// Sends the announcements a closed or refreshed tab never got to (see pending-booking-notices.ts), when a coach page opens. Only the coach's own, only a booking
// that is still confirmed and still ahead (one that was undone, cancelled or has passed is dropped silently); one that waited more than a few hours is returned
// for the coach to decide instead of being sent on its own. Never throws.
export const FLUSH_AFTER_MS = 15000;

export function announce(n: PendingNotice) {
  removePending(n.bookingId);
  notifyBookingConfirmed(n.athleteId, n.groupId, n.startIso);
  mirrorGoogleCalendarEvent(n.bookingId);
}

export async function flushDueNotices(supabase: SupabaseClient, coachId: string, now: number = Date.now()): Promise<{ sent: number; stale: PendingNotice[] }> {
  const result = { sent: 0, stale: [] as PendingNotice[] };
  try {
    const due = dueNotices(listPending(), coachId, now, FLUSH_AFTER_MS);
    if (due.length === 0) return result;
    const { data, error } = await supabase.from("bookings").select("id, status, start_at").in("id", due.map((n) => n.bookingId));
    if (error) return result;
    const live = new Map(((data ?? []) as { id: string; status: string; start_at: string }[]).filter((b) => b.status === "confirmed" && new Date(b.start_at).getTime() > now).map((b) => [b.id, b]));
    for (const n of due) {
      if (!live.has(n.bookingId)) {
        removePending(n.bookingId);
        continue;
      }
      if (isStale(n, now)) {
        result.stale.push(n);
        continue;
      }
      // Taken off the list first: if another tab is flushing too, whoever removes it first is the one that sends.
      announce(n);
      result.sent += 1;
    }
    return result;
  } catch {
    return result;
  }
}
