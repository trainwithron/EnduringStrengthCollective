import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canceledLine, isClientCancellation, lateStateLabel, toCanceledSession, type CanceledRow } from "./canceled-sessions";

// Ron, Nov 21: "Client canceled" made the session disappear from his calendar. It stays, marked, never blocking the time or counting.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const COACH = "coach-1";
const CLIENT = "client-1";
const row = (over: Partial<CanceledRow> = {}): CanceledRow => ({
  id: "b1",
  start_at: "2026-11-24T15:00:00.000Z",
  end_at: "2026-11-24T16:00:00.000Z",
  athlete_id: CLIENT,
  coach_id: COACH,
  group_id: "g1",
  cancelled_by: null,
  late_cancel: false,
  late_change_kind: null,
  late_charge_state: null,
  profiles: { full_name: "Hewan Belete" },
  ...over,
});

describe("which cancelled sessions stay on the coach's calendar", () => {
  it("the coach's Client canceled (charged or waived), a late cancel waiting for the coach, and one the client made themselves", () => {
    expect(isClientCancellation(row({ cancelled_by: COACH, late_cancel: true, late_change_kind: "cancel", late_charge_state: "charged" }))).toBe(true);
    expect(isClientCancellation(row({ cancelled_by: COACH, late_cancel: true, late_change_kind: "cancel", late_charge_state: "waived" }))).toBe(true);
    expect(isClientCancellation(row({ cancelled_by: CLIENT, late_cancel: true, late_change_kind: "cancel", late_charge_state: "flagged" }))).toBe(true);
    expect(isClientCancellation(row({ cancelled_by: CLIENT }))).toBe(true);
  });
  it("not a session the coach removed, not the old time of a moved session, not the coach's own placeholder for a group item", () => {
    expect(isClientCancellation(row({ cancelled_by: COACH }))).toBe(false);
    expect(isClientCancellation(row({ cancelled_by: null }))).toBe(false);
    expect(isClientCancellation(row({ athlete_id: COACH, cancelled_by: COACH }))).toBe(false);
  });
});

describe("what it says", () => {
  it("who cancelled where known, and the late-cancel state", () => {
    expect(canceledLine(toCanceledSession(row({ cancelled_by: COACH, late_cancel: true, late_change_kind: "cancel", late_charge_state: "charged" })))).toBe("Client canceled · Charged");
    expect(canceledLine(toCanceledSession(row({ cancelled_by: CLIENT, late_cancel: true, late_change_kind: "cancel", late_charge_state: "flagged" })))).toBe("Canceled by Hewan · Waiting for you");
    expect(canceledLine(toCanceledSession(row({ cancelled_by: CLIENT })))).toBe("Canceled by Hewan");
    expect(canceledLine(toCanceledSession(row({ cancelled_by: COACH, late_cancel: true, late_change_kind: "cancel", late_charge_state: "waived" })))).toBe("Client canceled · Waived");
    expect(lateStateLabel(null)).toBeNull();
  });
});

describe("on the coach's calendar, never in the way", () => {
  it("the computer calendar reads them on their own; the sessions that block times and the counts still read confirmed sessions only", () => {
    const body = read("components/coach/calendar-page-body.tsx");
    expect(body).toContain("readCanceledSessions(");
    expect(body).toContain("canceledByDateKey={canceledByDateKey}");
    expect(body).toMatch(/\.from\("bookings"\)\s*\.select\("id, start_at, end_at, athlete_id, recurring_series_id, profiles!bookings_athlete_id_fkey \( full_name \)"\)\s*\.eq\("coach_id", user\.id\)\s*\.in\("group_id", g\)\s*\.eq\("status", "confirmed"\)/);
    const grid = read("components/coach/desktop/calendar-grid.tsx");
    // the day panel that books times gets the sessions only, never the cancelled ones
    expect(grid).toContain("bookings={bookingsByDateKey.get(expandedKey) ?? []}");
    expect(grid).not.toMatch(/bookings=\{[^}]*canceled/);
    expect(grid).toContain('className="line-through"');
  });
  it("the day page draws them in the hour grid where a tap goes through to the open time, and lists them with Charge, Waive or Give it back", () => {
    const page = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(page).toContain("canceled={canceledToday.map(");
    expect(page).toContain("busyRanges={(bookingRows ?? []).map(");
    expect(page).toContain("<CanceledSessionActions bookingId={c.id} lateState={c.lateState} name={c.name} />");
    expect(page).toContain("id={`canceled-${c.id}`}");
    const hour = read("components/coach/desktop/day-hour-grid.tsx");
    expect(hour).toContain('className="absolute left-1 right-1 border border-dashed border-steel/50 text-steel px-2 py-0.5 overflow-hidden pointer-events-none"');
    const actions = read("components/coach/canceled-session-actions.tsx");
    expect(actions).toContain('rpc("resolve_late_change"');
    expect(actions).toContain("<GiveBackLateCancelButton");
  });
  it("the phone month shows them struck through, never in Upcoming; the client's own calendar never reads them", () => {
    const phone = read("components/coach/mobile/coach-phone-schedule.tsx");
    expect(phone).toContain('className: "text-steel line-through"');
    const upcomingDef = phone.slice(phone.indexOf("const upcomingRows = ["), phone.indexOf("];", phone.indexOf("const upcomingRows = [")));
    expect(upcomingDef.length).toBeGreaterThan(0);
    expect(upcomingDef).not.toMatch(/canceled/i);
    for (const f of ["lib/client-calendar.ts", "components/coach/desktop/client-calendar-section.tsx"]) expect(read(f)).not.toContain("canceled-sessions");
  });
});
