import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { AvailabilityManagerDesktop } from "./availability-manager-desktop";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Ron, Oct 31: 55-minute sessions with a 5-minute gap still drifted 5 minutes through the day. Two numbers now: session length and the gap after it; a
// start is offered every session + gap minutes.
describe("the hours editor has two numbers, not three", () => {
  const ron = [
    { id: "w1", weekday: 1, startTime: "08:00:00", endTime: "12:00:00", slotDurationMinutes: 60, sessionMinutes: 55 },
    { id: "w2", weekday: 2, startTime: "08:00:00", endTime: "12:00:00", slotDurationMinutes: 60, sessionMinutes: 55 },
  ];
  it("shows the session length and the gap, and the starts they make, on the hour", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: ron, sessionLengthEnabled: true, initialBufferMinutes: 5 }));
    expect(html).toContain("Session length (minutes)");
    expect(html).toContain("Gap between sessions (minutes)");
    expect(html).toContain('value="55"');
    expect(html).toContain('value="5"');
    expect(html).toContain("A session starts every 60 minutes: 8:00–8:55 AM, 9:00–9:55, 10:00–10:55, 11:00–11:55.");
    expect(html).toContain("4 sessions");
    expect(html).not.toContain("line them all up");
  });
  it("says so when older hours are set up with numbers that shift the starts, and Save lines them up", () => {
    const drifting = [{ id: "w1", weekday: 1, startTime: "08:00:00", endTime: "12:00:00", slotDurationMinutes: 55, sessionMinutes: null }];
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: drifting, sessionLengthEnabled: true, initialBufferMinutes: 5 }));
    expect(html).toContain("Press Save to line them all up.");
  });
  it("one row per day, Monday first, each with its own Add hours; a day with none reads Closed", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: ron, sessionLengthEnabled: true, initialBufferMinutes: 5 }));
    expect(html.indexOf(">Mon<")).toBeLessThan(html.indexOf(">Sun<"));
    expect(html.match(/aria-label="Add [A-Za-z]+ hours"/g)?.length).toBe(7);
    expect(html.match(/>Closed</g)?.length).toBe(5);
  });
  it("every window is saved with a start step of session + gap, and the gap is the coach's buffer", () => {
    const src = read("./availability-manager-desktop.tsx");
    expect(src).toContain("slot_duration_minutes: stepFor(session, gap),");
    expect(src.match(/\.\.\.timingColumns\(timing\.session, timing\.gap\),/g)?.length).toBe(3);
    expect(src).toContain('.update(timingColumns(session, gap)).eq("coach_id", coachId)');
    expect(src).toContain('from("coach_booking_policies").upsert({ coach_id: coachId, buffer_minutes: gap }');
    expect(read("../../../components/coach/calendar-page-body.tsx")).toContain("initialBufferMinutes={gapPolicy?.buffer_minutes ?? 0}");
    expect(read("./calendar-page-tabs.tsx")).toContain("initialBufferMinutes={initialBufferMinutes}");
  });
  it("the gap lives only with the hours: Booking rules no longer has its own buffer field (two fields could disagree)", () => {
    const rules = read("./booking-policy-control.tsx");
    expect(rules).not.toContain("Buffer between sessions");
    expect(rules).not.toContain("buffer_minutes");
  });
});
