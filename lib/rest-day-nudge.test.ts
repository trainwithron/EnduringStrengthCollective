import { describe, it, expect } from "vitest";
import { goalLabelFor, restDayNudgeBody, restNudgeDecision } from "./rest-day-nudge";

const now = new Date("2026-10-06T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86400000);

describe("restNudgeDecision", () => {
  it("sends when nothing was sent recently", () => {
    expect(restNudgeDecision({ nudgeTimes: [], lastActivityAt: null, now })).toEqual({ send: true });
  });
  it("sends at most two in any seven days", () => {
    expect(restNudgeDecision({ nudgeTimes: [ago(1)], lastActivityAt: ago(0.5), now })).toEqual({ send: true });
    expect(restNudgeDecision({ nudgeTimes: [ago(1), ago(3)], lastActivityAt: ago(0.5), now })).toEqual({ send: false, reason: "weekly_cap" });
    expect(restNudgeDecision({ nudgeTimes: [ago(1), ago(8)], lastActivityAt: ago(0.5), now })).toEqual({ send: true });
  });
  it("stops after three nudges in a row with no response, even spread over weeks", () => {
    const r = restNudgeDecision({ nudgeTimes: [ago(10), ago(17), ago(24)], lastActivityAt: ago(40), now });
    expect(r).toEqual({ send: false, reason: "unanswered" });
  });
  it("starts again once the client does something after the last nudges", () => {
    const r = restNudgeDecision({ nudgeTimes: [ago(10), ago(17), ago(24)], lastActivityAt: ago(2), now });
    expect(r).toEqual({ send: true });
  });
  it("counts only the nudges after their last activity as unanswered", () => {
    // Active 20 days ago, then nudged on days 18 and 9: two unanswered so far, a third is still allowed.
    expect(restNudgeDecision({ nudgeTimes: [ago(30), ago(18), ago(9)], lastActivityAt: ago(20), now })).toEqual({ send: true });
  });
});

describe("the nudge text", () => {
  it("names the client's goal when they have one, and stays plain without one", () => {
    expect(goalLabelFor("muscle_gain", null)).toBe("muscle gain");
    expect(goalLabelFor("custom", "run a half marathon")).toBe("run a half marathon");
    expect(goalLabelFor("custom", "  ")).toBeNull();
    expect(goalLabelFor(null, null)).toBeNull();
    expect(restDayNudgeBody("muscle gain")).toBe("Rest day. A quick check-in keeps you on track for your muscle gain goal.");
    expect(restDayNudgeBody(null)).toBe("Rest day. Got a minute for a quick check-in?");
  });
});

import { readFileSync } from "node:fs";
describe("the nightly job", () => {
  const src = readFileSync(new URL("../app/api/cron/rest-day-nudge/route.ts", import.meta.url), "utf8");
  it("checks the record before it sends, sends nothing when the record cannot be read, and writes the record after a successful send", () => {
    expect(src.indexOf("rest_day_nudges")).toBeLessThan(src.indexOf("sendPushToProfile("));
    expect(src).toContain("if (nudgeError) continue;");
    expect(src).toContain("if (!decision.send) continue;");
    expect(src.indexOf("if (sent > 0) await supabase.from(\"rest_day_nudges\").insert")).toBeGreaterThan(src.indexOf("sendPushToProfile("));
  });
});
