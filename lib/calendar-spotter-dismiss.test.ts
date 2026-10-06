import { describe, it, expect } from "vitest";
import { ATTENDANCE_LONG_SNOOZE_DAYS, attendanceDismissalKey, isAttendanceDismissed } from "./calendar-spotter-dismiss";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
const key = attendanceDismissalKey("alice", "gap");

describe("putting a Calendar Spot row away", () => {
  it("a finding that was never put away is shown", () => {
    expect(isAttendanceDismissed([], key, now)).toBe(false);
  });
  it("'Not now' keeps it quiet for 2 weeks, then it may come back", () => {
    expect(isAttendanceDismissed([{ dismissal_key: key, created_at: ago(3) }], key, now)).toBe(true);
    expect(isAttendanceDismissed([{ dismissal_key: key, created_at: ago(15) }], key, now)).toBe(false);
  });
  it("'Don't flag them' keeps it quiet for 60 days", () => {
    const row = { dismissal_key: key, created_at: ago(40), edit_detail: String(ATTENDANCE_LONG_SNOOZE_DAYS) };
    expect(isAttendanceDismissed([row], key, now)).toBe(true);
    expect(isAttendanceDismissed([{ ...row, created_at: ago(61) }], key, now)).toBe(false);
  });
  it("the newest answer wins, and another client or another kind of finding is not affected", () => {
    expect(isAttendanceDismissed([{ dismissal_key: key, created_at: ago(40), edit_detail: "60" }, { dismissal_key: key, created_at: ago(1), edit_detail: "14" }], key, now)).toBe(true);
    expect(isAttendanceDismissed([{ dismissal_key: attendanceDismissalKey("bob", "gap"), created_at: ago(1) }], key, now)).toBe(false);
    expect(isAttendanceDismissed([{ dismissal_key: attendanceDismissalKey("alice", "flaky"), created_at: ago(1) }], key, now)).toBe(false);
  });
  it("a nonsense length falls back to the 2-week default", () => {
    expect(isAttendanceDismissed([{ dismissal_key: key, created_at: ago(20), edit_detail: "abc" }], key, now)).toBe(false);
    expect(isAttendanceDismissed([{ dismissal_key: key, created_at: ago(5), edit_detail: "-3" }], key, now)).toBe(true);
  });
});
