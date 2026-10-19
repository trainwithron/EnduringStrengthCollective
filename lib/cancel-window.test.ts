import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { insideWindowHours } from "@/lib/cancel-window";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-19T14:00:00Z");

// Oct 19 audit item 10: Johann cancelled inside the window with only the generic line, while Ron got a "charge it or waive it" notice Johann never learned about.
describe("is this session inside the coach's cancellation window", () => {
  it("returns the window's hours when the session is closer than that, else null", () => {
    expect(insideWindowHours("2026-10-20T00:00:00Z", 24, NOW)).toBe(24); // 10 hours away
    expect(insideWindowHours("2026-10-21T00:00:00Z", 24, NOW)).toBeNull(); // 34 hours away
    expect(insideWindowHours("2026-10-20T14:00:00Z", 24, NOW)).toBeNull(); // exactly 24 hours: outside
  });
  it("no policy row uses the database default of 24 hours; a window of 0 means none", () => {
    expect(insideWindowHours("2026-10-20T00:00:00Z", null, NOW)).toBe(24);
    expect(insideWindowHours("2026-10-20T00:00:00Z", 0, NOW)).toBeNull();
    expect(insideWindowHours("2026-10-19T19:30:00Z", 6, NOW)).toBe(6);
  });
  it("a session that has already started is not inside the window", () => {
    expect(insideWindowHours("2026-10-19T13:00:00Z", 24, NOW)).toBeNull();
  });
});

// Oct 19 audit item 9: in "I schedule everyone" mode Reschedule led to a page with nothing to pick and no Message button.
describe("Reschedule when the coach schedules everyone", () => {
  it("shows 'Message your coach to move it' (a link to the messages) and no Reschedule", () => {
    const html = renderToStaticMarkup(createElement(CancelBookingButton, { bookingId: "b1", messageHref: "/groups/g1/messages" }));
    expect(html).toContain("Message your coach to move it");
    expect(html).toContain('href="/groups/g1/messages"');
    expect(html).not.toContain(">Reschedule<");
  });
  it("with a reschedule address it still shows Reschedule, and not the message link", () => {
    const html = renderToStaticMarkup(createElement(CancelBookingButton, { bookingId: "b1", rescheduleHref: "/x?reschedule=b1", messageHref: "/groups/g1/messages" }));
    expect(html).toContain(">Reschedule<");
    expect(html).not.toContain("Message your coach to move it");
  });
  const list = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx");
  const day = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx");
  it("both client pages pick the message link in that mode and pass the window to the cancel button", () => {
    for (const src of [list, day]) {
      expect(src).toContain('bookingMode === "coach_schedules" ? undefined :');
      expect(src).toContain('messageHref={bookingMode === "coach_schedules" ? `/groups/${params.groupId}/messages` : undefined}');
      expect(src).toContain("insideWindowHours={insideWindowHours(start, cancelWindowHours)}");
      expect(src).toContain('.select("booking_mode, cancellation_window_hours")'.replace(/^\./, ""));
    }
  });
  it("empty days are not tappable in that mode (a day page with nothing to pick is a dead end)", () => {
    expect(list).toContain('const daysTappable = hasAvailability && bookingMode !== "coach_schedules";');
    expect(list).toContain("if (!w && daysTappable) {");
  });
});
