// Calendar Spotter — data-orchestration layer (real Supabase queries, no
// unit tests of its own, same convention as lib/programming-spotter-gather.ts
// and lib/coach-briefing-gather.ts — only the pure lib/calendar-spotter.ts
// functions it calls are tested). Roster-wide, not single-subject, since
// attendance drift is a per-athlete question across the whole group, same
// shape as the low-readiness flag already computed for the Clients page.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectAttendanceGap,
  detectFlakyAttendancePattern,
  detectAttendanceRecovery,
  type AttendanceBooking,
} from "./calendar-spotter";

export interface CalendarSpotterFinding {
  athleteId: string;
  athleteName: string;
  kind: "gap" | "flaky" | "recovery";
  message: string;
}

// 60 days back is enough history for both the 14-day gap check and the
// 28-day flaky-pattern window, plus enough runway before either for the
// recovery check to find a real prior flag to recover from.
const LOOKBACK_DAYS = 60;

export async function gatherCalendarSpotterFindings(
  supabase: SupabaseClient,
  params: { groupId: string }
): Promise<CalendarSpotterFinding[]> {
  const { groupId } = params;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: rows } = await supabase
    .from("bookings")
    .select("athlete_id, start_at, status, no_show, late_cancel, profiles!bookings_athlete_id_fkey ( full_name )")
    .eq("group_id", groupId)
    .gte("start_at", since);

  if (!rows || rows.length === 0) return [];

  const byAthlete = new Map<string, { name: string; bookings: AttendanceBooking[] }>();
  for (const row of rows as any[]) {
    const entry = byAthlete.get(row.athlete_id) ?? {
      name: row.profiles?.full_name ?? "Client",
      bookings: [] as AttendanceBooking[],
    };
    entry.bookings.push({
      startAt: new Date(row.start_at),
      status: row.status,
      noShow: row.no_show,
      lateCancel: row.late_cancel,
    });
    byAthlete.set(row.athlete_id, entry);
  }

  const now = new Date();
  const findings: CalendarSpotterFinding[] = [];

  for (const [athleteId, { name, bookings }] of byAthlete) {
    const gap = detectAttendanceGap(bookings, now);
    if (gap.isGapped) {
      findings.push({
        athleteId,
        athleteName: name,
        kind: "gap",
        message: `${name} hasn't attended a session in ${gap.daysSinceLastAttended} days.`,
      });
      continue;
    }

    const flaky = detectFlakyAttendancePattern(bookings, now);
    if (flaky.isFlaky) {
      findings.push({
        athleteId,
        athleteName: name,
        kind: "flaky",
        message: `${name} has missed or last-minute cancelled ${flaky.flakyEventCount} sessions in the last 4 weeks.`,
      });
      continue;
    }

    const recovery = detectAttendanceRecovery(bookings, now);
    if (recovery.isRecovered) {
      findings.push({
        athleteId,
        athleteName: name,
        kind: "recovery",
        message: `${name} is back to a regular schedule after a rough stretch — worth a shoutout next time you see them.`,
      });
    }
  }

  return findings;
}
