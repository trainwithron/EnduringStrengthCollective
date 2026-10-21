import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NOTICE_KINDS } from "./coach-notice-kinds";
import { NotificationSettings, notificationsSummary } from "@/components/shared/notification-settings";

// Ron, Oct 21: push notifications in Settings "Needs to be collapsible. That's way too big."; the passage "I don't want to have to select it every day".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("Settings > Notifications is one closed row", () => {
  it("says how many kinds of notice are on, and just 'Push notifications' without the switches", () => {
    expect(notificationsSummary([])).toBe(`Push notifications · ${NOTICE_KINDS.length} of ${NOTICE_KINDS.length} on`);
    expect(notificationsSummary([NOTICE_KINDS[0].id])).toBe(`Push notifications · ${NOTICE_KINDS.length - 1} of ${NOTICE_KINDS.length} on`);
    expect(notificationsSummary(null)).toBe("Push notifications");
  });
  it("is closed until tapped, the same on a computer and a phone, and the count follows the switches", () => {
    const html = renderToStaticMarkup(createElement(NotificationSettings, { profileId: "p", audience: "coach", pushPrefs: null, notices: { initialOff: [] } }));
    expect(html).toMatch(/<details[^>]*data-notification-settings/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(read("components/shared/notification-settings.tsx")).toContain("onOffChange={setOff}");
    expect(read("components/coach/notice-switches.tsx")).toContain("onOffChange?.(next);");
  });
});

describe("the passage is automatic; choosing one for a day is optional", () => {
  it("says so at the top, with the day choice under one closed row", () => {
    const s = read("components/coach/read-during-rest-settings.tsx");
    expect(s).toContain("A passage is picked for every client automatically each day.");
    expect(s).toContain("Choose one for a specific day (optional)");
    expect(s.indexOf("data-passage-automatic")).toBeLessThan(s.indexOf("data-passage-day-choice"));
    expect(s).not.toContain("Set passage");
    expect(s).not.toContain("Choose a passage");
  });
});
