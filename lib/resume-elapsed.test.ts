import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumedStartedAt } from "@/lib/resume-elapsed";

describe("resuming a paused workout does not count the time it was paused", () => {
  const now = new Date("2026-10-13T18:00:00.000Z");
  it("carries on from the last completed set: 40 minutes of work, 3 hours paused, resumes at 0:40:00", () => {
    const started = "2026-10-13T14:00:00.000Z";
    const lastSet = "2026-10-13T14:40:00.000Z";
    const next = resumedStartedAt(started, lastSet, now);
    expect(now.getTime() - new Date(next).getTime()).toBe(40 * 60000);
  });
  it("with no completed set it restarts the timer at zero", () => {
    const next = resumedStartedAt("2026-10-13T14:00:00.000Z", null, now);
    expect(next).toBe(now.toISOString());
  });
  it("never moves the start into the future or before the original start", () => {
    const next = resumedStartedAt("2026-10-13T17:30:00.000Z", "2026-10-13T19:00:00.000Z", now);
    expect(new Date(next).getTime()).toBeGreaterThanOrEqual(new Date("2026-10-13T17:30:00.000Z").getTime());
    expect(new Date(next).getTime()).toBeLessThanOrEqual(now.getTime());
  });
  it("the session page applies it when a paused workout is resumed", () => {
    const page = readFileSync(join(__dirname, "..", "app/sessions/[sessionId]/page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("resumedStartedAt(");
    expect(page).toContain('.update({ started_at: newStart })');
  });
});
