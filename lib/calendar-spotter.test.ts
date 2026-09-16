import { describe, it, expect } from "vitest";
import {
  detectAttendanceGap,
  detectFlakyAttendancePattern,
  detectAttendanceRecovery,
  type AttendanceBooking,
} from "./calendar-spotter";

const ASOF = new Date("2026-09-15T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(ASOF.getTime() - days * 86400000);
}

function booking(overrides: Partial<AttendanceBooking> = {}): AttendanceBooking {
  return {
    startAt: daysAgo(1),
    status: "confirmed",
    noShow: false,
    lateCancel: false,
    ...overrides,
  };
}

describe("detectAttendanceGap", () => {
  it("does not flag a client attending on a normal cadence", () => {
    const result = detectAttendanceGap(
      [booking({ startAt: daysAgo(3) }), booking({ startAt: daysAgo(10) })],
      ASOF
    );
    expect(result.isGapped).toBe(false);
    expect(result.daysSinceLastAttended).toBe(3);
  });

  it("does not flag right at the 14-day boundary itself being under threshold", () => {
    const result = detectAttendanceGap([booking({ startAt: daysAgo(13) })], ASOF);
    expect(result.isGapped).toBe(false);
    expect(result.daysSinceLastAttended).toBe(13);
  });

  it("flags exactly at the 14-day threshold", () => {
    const result = detectAttendanceGap([booking({ startAt: daysAgo(14) })], ASOF);
    expect(result.isGapped).toBe(true);
    expect(result.daysSinceLastAttended).toBe(14);
  });

  it("flags well past the threshold", () => {
    const result = detectAttendanceGap([booking({ startAt: daysAgo(30) })], ASOF);
    expect(result.isGapped).toBe(true);
  });

  it("never flags when the client has never attended a session at all — no baseline to gap from", () => {
    const result = detectAttendanceGap([], ASOF);
    expect(result.isGapped).toBe(false);
    expect(result.daysSinceLastAttended).toBeNull();
  });

  it("a no-show doesn't count as attendance, even though the booking was 'confirmed'", () => {
    const result = detectAttendanceGap(
      [booking({ startAt: daysAgo(20), noShow: true }), booking({ startAt: daysAgo(1), status: "cancelled" })],
      ASOF
    );
    // Neither row is a real attended session — the no-show is confirmed
    // but flagged, and the other is cancelled outright.
    expect(result.daysSinceLastAttended).toBeNull();
    expect(result.isGapped).toBe(false);
  });

  it("ignores a future booking when computing the last real attendance", () => {
    const result = detectAttendanceGap(
      [booking({ startAt: daysAgo(20) }), booking({ startAt: daysAgo(-5) })],
      ASOF
    );
    expect(result.daysSinceLastAttended).toBe(20);
    expect(result.isGapped).toBe(true);
  });
});

describe("detectFlakyAttendancePattern", () => {
  it("does not flag a single no-show", () => {
    const result = detectFlakyAttendancePattern([booking({ startAt: daysAgo(5), noShow: true })], ASOF);
    expect(result.isFlaky).toBe(false);
    expect(result.flakyEventCount).toBe(1);
  });

  it("flags two no-shows within the rolling window", () => {
    const result = detectFlakyAttendancePattern(
      [booking({ startAt: daysAgo(5), noShow: true }), booking({ startAt: daysAgo(20), noShow: true })],
      ASOF
    );
    expect(result.isFlaky).toBe(true);
    expect(result.flakyEventCount).toBe(2);
  });

  it("counts a late cancellation the same as a no-show", () => {
    const result = detectFlakyAttendancePattern(
      [
        booking({ startAt: daysAgo(5), status: "cancelled", lateCancel: true }),
        booking({ startAt: daysAgo(20), noShow: true }),
      ],
      ASOF
    );
    expect(result.isFlaky).toBe(true);
  });

  it("does NOT count an on-time cancellation — that's responsible behavior, not disengagement", () => {
    const result = detectFlakyAttendancePattern(
      [
        booking({ startAt: daysAgo(5), status: "cancelled", lateCancel: false }),
        booking({ startAt: daysAgo(20), status: "cancelled", lateCancel: false }),
      ],
      ASOF
    );
    expect(result.isFlaky).toBe(false);
    expect(result.flakyEventCount).toBe(0);
  });

  it("does not count a flaky event outside the rolling window", () => {
    const result = detectFlakyAttendancePattern(
      [booking({ startAt: daysAgo(5), noShow: true }), booking({ startAt: daysAgo(29), noShow: true })],
      ASOF
    );
    expect(result.isFlaky).toBe(false);
    expect(result.flakyEventCount).toBe(1);
  });

  it("counts a flaky event right at the window boundary", () => {
    const result = detectFlakyAttendancePattern(
      [booking({ startAt: daysAgo(5), noShow: true }), booking({ startAt: daysAgo(28), noShow: true })],
      ASOF
    );
    expect(result.isFlaky).toBe(true);
    expect(result.flakyEventCount).toBe(2);
  });

  it("a normal attended session doesn't count toward the flaky total", () => {
    const result = detectFlakyAttendancePattern(
      [booking({ startAt: daysAgo(5) }), booking({ startAt: daysAgo(10) })],
      ASOF
    );
    expect(result.flakyEventCount).toBe(0);
  });
});

describe("detectAttendanceRecovery", () => {
  it("fires after a genuine flag, then two consecutive attended sessions", () => {
    const result = detectAttendanceRecovery(
      [
        booking({ startAt: daysAgo(30), noShow: true }),
        booking({ startAt: daysAgo(20), noShow: true }),
        booking({ startAt: daysAgo(10) }),
        booking({ startAt: daysAgo(3) }),
      ],
      ASOF
    );
    expect(result.isRecovered).toBe(true);
  });

  it("does not fire on a clean history with no prior flaky event — nothing to recover from", () => {
    const result = detectAttendanceRecovery(
      [booking({ startAt: daysAgo(10) }), booking({ startAt: daysAgo(3) })],
      ASOF
    );
    expect(result.isRecovered).toBe(false);
  });

  it("does not fire if the most recent session is itself a no-show", () => {
    const result = detectAttendanceRecovery(
      [
        booking({ startAt: daysAgo(30), noShow: true }),
        booking({ startAt: daysAgo(10) }),
        booking({ startAt: daysAgo(3), noShow: true }),
      ],
      ASOF
    );
    expect(result.isRecovered).toBe(false);
  });

  it("does not fire on only one attended session after a flag — needs two in a row", () => {
    const result = detectAttendanceRecovery(
      [booking({ startAt: daysAgo(30), noShow: true }), booking({ startAt: daysAgo(3) })],
      ASOF
    );
    expect(result.isRecovered).toBe(false);
  });

  it("an on-time cancellation between the flag and the recovery streak doesn't reset or block it", () => {
    const result = detectAttendanceRecovery(
      [
        booking({ startAt: daysAgo(30), noShow: true }),
        booking({ startAt: daysAgo(20), status: "cancelled", lateCancel: false }),
        booking({ startAt: daysAgo(10) }),
        booking({ startAt: daysAgo(3) }),
      ],
      ASOF
    );
    expect(result.isRecovered).toBe(true);
  });

  it("empty history never fires", () => {
    expect(detectAttendanceRecovery([], ASOF).isRecovered).toBe(false);
  });
});
