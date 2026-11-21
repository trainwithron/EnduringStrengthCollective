import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canGiveBack, lateCancelConfirmLine, lateOutcome } from "./late-cancel-auto";

// Wave 2 C5 (Ron, Nov 20): a late cancel takes the session automatically, as a per-coach setting, credits only, with a give-back button. Off by default.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the client is told before they cancel", () => {
  it("setting on: it uses a session and the coach can give it back", () => {
    expect(lateCancelConfirmLine(24, true)).toBe("This is inside your coach's 24-hour window, so it uses one of your sessions. Your coach can give it back. Cancel anyway?");
  });
  it("setting off: the coach decides, exactly as before", () => {
    expect(lateCancelConfirmLine(24, false)).toBe("This is inside your coach's 24-hour window. Your coach will be told and decides whether it counts as a session. Cancel anyway?");
  });
  it("setting unreadable: never promises it won't count", () => {
    expect(lateCancelConfirmLine(24, null)).toContain("so it may use one of your sessions");
  });
  it("every client cancel button gets the window and the setting", () => {
    for (const f of ["components/coach/calendar-page-body.tsx", "app/(coach)/groups/[groupId]/calendar/[date]/page.tsx"]) {
      expect(read(f)).toContain("lateCancelTakesSession={cancelPolicy.takesSession}");
      expect(read(f)).toContain("insideWindowHours={insideWindowHours(start, cancelPolicy.windowHours)}");
    }
    for (const f of ["app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx", "app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      expect(read(f)).toContain("lateCancelTakesSession={lateCancelTakesSession}");
      expect(read(f)).toContain("lateCancelTakesSession = await readLateCancelTakesSession(supabase, coachMembership.profile_id);");
    }
  });
});

describe("the coach", () => {
  it("turns it on in Booking rules (off by default; hidden until the column exists)", () => {
    const control = read("components/coach/desktop/booking-policy-control.tsx");
    expect(control).toContain('.upsert({ coach_id: coachId, late_cancel_takes_session: next }, { onConflict: "coach_id" })');
    expect(control).toContain("initialLateCancelTakesSession !== null &&");
    expect(read("supabase/migrations/0458_wave2_calendar.sql")).toContain("add column if not exists late_cancel_takes_session boolean not null default false");
  });
  it("sees what happened on Requests and can give back a charged late cancel (not a late move)", () => {
    expect(lateOutcome({ late_charge_state: "charged", late_charge_auto: true })).toBe("Took one session (your late-cancel setting)");
    expect(lateOutcome({ late_charge_state: "charged", late_charge_auto: false })).toBe("Charged one session");
    expect(canGiveBack({ late_charge_state: "charged", late_change_kind: "cancel" })).toBe(true);
    expect(canGiveBack({ late_charge_state: "charged", late_change_kind: "reschedule" })).toBe(false);
    expect(canGiveBack({ late_charge_state: "waived", late_change_kind: "cancel" })).toBe(false);
    expect(read("components/coach/requests-center.tsx")).toContain('{a.kind === "late" && a.giveBack && <GiveBackLateCancelButton bookingId={a.id} who={a.who} />}');
    expect(read("components/coach/give-back-late-cancel-button.tsx")).toContain('rpc("give_back_late_cancel", { p_booking_id: bookingId })');
  });
});
