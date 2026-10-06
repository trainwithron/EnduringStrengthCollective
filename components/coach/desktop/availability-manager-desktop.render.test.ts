import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { AvailabilityManagerDesktop } from "./availability-manager-desktop";

const windows = [
  { id: "w1", weekday: 1, startTime: "06:00:00", endTime: "17:00:00", slotDurationMinutes: 60 },
  { id: "w2", weekday: 2, startTime: "06:00:00", endTime: "17:00:00", slotDurationMinutes: 60 },
];

describe("Availability: recurring hours", () => {
  it("every existing window can be edited, copied to other days and deleted", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityManagerDesktop, { coachId: "c", initialWindows: windows }));
    expect(html).toContain('aria-label="Edit Monday hours"');
    expect(html).toContain('aria-label="Edit Tuesday hours"');
    expect(html).toContain('aria-label="Copy Monday hours to other days"');
    expect(html).toContain('aria-label="Delete window"');
    expect(html).toContain("06:00–17:00");
  });
});
