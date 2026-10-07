import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ rpc: async () => ({ error: null }) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { RequestDifferentTime } from "./request-different-time";
import { AssignOtherTime } from "../coach/desktop/assign-other-time";

describe("Ask for a different time (request mode)", () => {
  const options = [
    { startAt: "2026-10-20T13:15:00.000Z", endAt: "2026-10-20T14:10:00.000Z", label: "6:15 AM" },
    { startAt: "2026-10-20T13:20:00.000Z", endAt: "2026-10-20T14:15:00.000Z", label: "6:20 AM" },
  ];
  it("is a quiet control beside the regular slots, closed until asked for", () => {
    const html = renderToStaticMarkup(createElement(RequestDifferentTime, { coachId: "c", athleteId: "a", groupId: "g", options, sessionMinutes: 55 }));
    expect(html).toContain("Ask for a different time");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Ask for this time");
  });
  it("shows nothing when there is no time to offer", () => {
    expect(renderToStaticMarkup(createElement(RequestDifferentTime, { coachId: "c", athleteId: "a", groupId: "g", options: [], sessionMinutes: 55 }))).toBe("");
  });
  it("makes an ordinary request the coach confirms (request_booking), never a booking", () => {
    const src = readFileSync(new URL("./request-different-time.tsx", import.meta.url), "utf8");
    expect(src).toContain('rpc("request_booking"');
    expect(src).not.toContain('rpc("book_session"');
    expect(src).toContain("Your coach confirms it before it is booked");
  });
});

describe("the coach's Another time", () => {
  it("has a start in 5-minute steps and a length, and books through the same book_session call", () => {
    const html = renderToStaticMarkup(
      createElement(AssignOtherTime, { coachId: "c", athleteId: "a", groupId: "g", dateKey: "2026-10-20", timezone: "America/Los_Angeles", defaultMinutes: 55, openRanges: [], busyRanges: [] })
    );
    expect(html).toContain("Another time");
    expect(html).toContain('step="300"');
    expect(html).toContain('placeholder="55"');
    expect(readFileSync(new URL("../coach/desktop/assign-other-time.tsx", import.meta.url), "utf8")).toContain('rpc("book_session"');
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("both client calendar pages offer the different-time control in request mode and say Booked for a slot another session overlaps", () => {
    for (const p of ["../../app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "../../app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      const src = read(p);
      expect(src).toContain("<RequestDifferentTime");
      expect(src).toContain("customStartOptions(");
      expect(src).toContain('conflict === "taken" ? "Booked"');
      expect(src).toContain("Waiting for your coach");
    }
  });
  it("the coach's day page and the drag-in scheduler have an Another time, and the scheduler marks overlapped slots as booked", () => {
    expect(read("../../app/(coach)/groups/[groupId]/calendar/[date]/page.tsx")).toContain("<AssignOtherTime");
    const sched = read("../coach/desktop/expanded-day-scheduler.tsx");
    expect(sched).toContain("Another time");
    expect(sched).toContain("b.startMs < slotEndMs");
  });
  it("the confirm card shows the end time, the coach's clock and an outside-hours note", () => {
    const src = read("../coach/late-changes-panel.tsx");
    expect(src).toContain("new_end_at");
    expect(src).toContain("tzName(m.newStartAt)");
    expect(src).toContain("Outside your open hours or on your time off. You can still confirm it.");
  });
  it("the daily conflict check passes the session's end, so a recurring session at any minute inside the hours is not flagged", () => {
    const cron = read("../../app/api/cron/flag-recurring-booking-conflicts/route.ts");
    expect(cron).toContain("start_at, end_at");
    expect(cron).toContain("new Date(booking.end_at)");
  });
  it("the hours editor has 15, 30, 45 and 60 as one-tap steps", () => {
    expect(read("../coach/desktop/availability-manager-desktop.tsx")).toContain("<StepPresets");
  });
});
