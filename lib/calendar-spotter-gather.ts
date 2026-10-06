// Calendar Spotter — data-orchestration layer (real Supabase queries, no
// unit tests of its own, same convention as lib/programming-spotter-gather.ts
// and lib/coach-briefing-gather.ts — only the pure lib/calendar-spotter.ts
// functions it calls are tested). Roster-wide, not single-subject, since
// attendance drift is a per-athlete question across the whole group, same
// shape as the low-readiness flag already computed for the Clients page.
import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceDismissalKey, isAttendanceDismissed } from "./calendar-spotter-dismiss";
import { fetchInactiveKeys, inactiveKey } from "./inactive-ids";
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
  // The client's next confirmed session, so the coach can cancel it from the row (the existing cancel flow, with its refund and late-change rules).
  nextBooking?: { id: string; startAt: string; recurringSeriesId: string | null; sessionTypeName?: string | null } | null;
}

// 60 days back is enough history for both the 14-day gap check and the
// 28-day flaky-pattern window, plus enough runway before either for the
// recovery check to find a real prior flag to recover from.
const LOOKBACK_DAYS = 60;

export async function gatherCalendarSpotterFindings(
  supabase: SupabaseClient,
  // `coachId`, when given, applies that coach's own "Not now" answers and leaves out clients they set aside as inactive. The nightly jobs do not pass it.
  params: { groupId: string; coachId?: string }
): Promise<CalendarSpotterFinding[]> {
  const { groupId, coachId } = params;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: rows } = await supabase
    .from("bookings")
    .select("id, athlete_id, start_at, status, no_show, late_cancel, recurring_series_id, session_types ( name ), profiles!bookings_athlete_id_fkey ( full_name )")
    .eq("group_id", groupId)
    .gte("start_at", since);

  if (!rows || rows.length === 0) return [];

  const byAthlete = new Map<string, { name: string; bookings: AttendanceBooking[] }>();
  const nextByAthlete = new Map<string, { id: string; startAt: string; recurringSeriesId: string | null; sessionTypeName: string | null }>();
  const nowMs = Date.now();
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
    if (row.status === "confirmed" && new Date(row.start_at).getTime() > nowMs) {
      const cur = nextByAthlete.get(row.athlete_id);
      if (!cur || new Date(row.start_at).getTime() < new Date(cur.startAt).getTime()) nextByAthlete.set(row.athlete_id, { id: row.id, startAt: row.start_at, recurringSeriesId: row.recurring_series_id ?? null, sessionTypeName: row.session_types?.name ?? null });
    }
  }

  // The coach's own answers (Not now / Don't flag), and clients they have set aside. Both soft: a failed lookup shows every finding, as before.
  let dismissals: { dismissal_key: string; created_at: string; edit_detail: string | null }[] = [];
  let inactive = new Set<string>();
  if (coachId) {
    const { data } = await supabase
      .from("spotter_recommendation_feedback")
      .select("dismissal_key, created_at, edit_detail")
      .eq("coach_id", coachId)
      .eq("spotter_kind", "calendar")
      .like("dismissal_key", "attendance::%")
      .order("created_at", { ascending: false })
      .limit(300);
    dismissals = (data ?? []) as typeof dismissals;
    inactive = await fetchInactiveKeys(supabase, [groupId]);
  }
  const quiet = (athleteId: string, kind: "gap" | "flaky" | "recovery") =>
    !!coachId && (inactive.has(inactiveKey(groupId, athleteId)) || isAttendanceDismissed(dismissals, attendanceDismissalKey(athleteId, kind), new Date()));

  const now = new Date();
  const findings: CalendarSpotterFinding[] = [];

  for (const [athleteId, { name, bookings }] of byAthlete) {
    const gap = detectAttendanceGap(bookings, now);
    if (gap.isGapped) {
      if (!quiet(athleteId, "gap")) {
        findings.push({
          athleteId,
          athleteName: name,
          kind: "gap",
          message: `${name} hasn't attended a session in ${gap.daysSinceLastAttended} days.`,
          nextBooking: nextByAthlete.get(athleteId) ?? null,
        });
      }
      continue;
    }

    const flaky = detectFlakyAttendancePattern(bookings, now);
    if (flaky.isFlaky) {
      if (!quiet(athleteId, "flaky")) {
        findings.push({
          athleteId,
          athleteName: name,
          kind: "flaky",
          message: `${name} has missed or last-minute cancelled ${flaky.flakyEventCount} sessions in the last 4 weeks.`,
          nextBooking: nextByAthlete.get(athleteId) ?? null,
        });
      }
      continue;
    }

    const recovery = detectAttendanceRecovery(bookings, now);
    if (recovery.isRecovered && !quiet(athleteId, "recovery")) {
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
