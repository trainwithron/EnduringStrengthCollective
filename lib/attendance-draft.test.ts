import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { buildComeBackDraft } from "./attendance-draft";
import { CalendarSpotterPanel } from "@/components/coach/desktop/calendar-spotter-panel";

describe("attendance: a drafted note for the coach, never an automatic text", () => {
  it("drafts a warm note with no guilt and no money", () => {
    const t = buildComeBackDraft("Sam");
    expect(t).toContain("Hi Sam");
    expect(t).not.toMatch(/pay|owe|refund|credit|missed/i);
    expect(buildComeBackDraft("")).toContain("Hi there");
  });

  it("a gap finding gets a Send a note button that opens the message box with the draft; other findings do not", () => {
    const findings = [
      { athleteId: "a1", athleteName: "Sam Lee", kind: "gap" as const, message: "Sam Lee hasn't attended in 16 days" },
      { athleteId: "a2", athleteName: "Kim Wu", kind: "flaky" as const, message: "Kim Wu cancels often" },
    ];
    const html = renderToStaticMarkup(createElement(CalendarSpotterPanel, { findings, groupId: "g1" }));
    expect(html).toContain("Send a note");
    expect(html).toContain("/groups/g1/messages/a1?draft=");
    expect(html.match(/Send a note/g)?.length).toBe(1);
  });

  it("the nightly job does not text anyone unless it is turned on on purpose", () => {
    const src = readFileSync(new URL("../app/api/cron/attendance-nudge-sms/route.ts", import.meta.url), "utf8");
    expect(src).toContain('process.env.ATTENDANCE_NUDGE_AUTO_SEND === "true"');
    expect(src.indexOf("if (!ATTENDANCE_AUTO_SEND_ENABLED)")).toBeLessThan(src.indexOf("dispatchSms(supabase"));
  });
});
