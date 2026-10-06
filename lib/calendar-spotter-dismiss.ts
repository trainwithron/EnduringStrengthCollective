// Calendar Spot rows can be put away (Ron, Oct 6: he had no way to clear a row about Alice, a test client he wants kept). "Not now" keeps a finding quiet for
// 2 weeks; "Don't flag {name}" keeps that kind of finding quiet for that client for 60 days. Both are the coach's own feedback rows (kind "calendar"), no new
// table, and nothing about a client changes: only whether the Spot mentions them.

export const ATTENDANCE_SNOOZE_DAYS = 14;
export const ATTENDANCE_LONG_SNOOZE_DAYS = 60;
const DAY = 86400000;

export const attendanceCheckKind = "attendance";
export const attendancePatternKey = (athleteId: string, kind: "gap" | "flaky" | "recovery") => `${athleteId}::${kind}`;
export const attendanceDismissalKey = (athleteId: string, kind: "gap" | "flaky" | "recovery") => `${attendanceCheckKind}::${attendancePatternKey(athleteId, kind)}`;

export interface DismissalRow {
  dismissal_key: string;
  created_at: string;
  edit_detail?: string | null;
}

// The newest answer for this finding decides: it is quiet for the number of days stored on it (the 2-week default when none is).
export function isAttendanceDismissed(rows: DismissalRow[], key: string, now: Date): boolean {
  const own = rows.filter((r) => r.dismissal_key === key).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (!own) return false;
  const days = Number(own.edit_detail);
  const quietDays = Number.isFinite(days) && days > 0 && days <= 365 ? days : ATTENDANCE_SNOOZE_DAYS;
  return now.getTime() - new Date(own.created_at).getTime() < quietDays * DAY;
}
