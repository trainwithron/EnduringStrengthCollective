import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headlineMrr } from "./coach-mrr";
import { shortDateLabel } from "./apply-from";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the coach's MRR is one number everywhere", () => {
  it("real subscriptions when there are any, otherwise the estimate from set rates", () => {
    expect(headlineMrr(1200, 900)).toEqual({ value: 1200, estimated: false });
    expect(headlineMrr(0, 900)).toEqual({ value: 900, estimated: true });
    expect(headlineMrr(0, 0)).toEqual({ value: 0, estimated: true });
  });
  it("the Business page reads it through the shared function (the phone Home no longer shows business numbers: they are under More > Business)", () => {
    const phone = read("components/coach/mobile/coach-mobile-home.tsx");
    expect(phone).not.toContain("loadCoachMrr");
    expect(phone).not.toContain("computeRealMRR");
    expect(read("lib/coach-mrr.ts")).toContain("loadBusinessScope(supabase, coachId, groupId)"); // every group the coach runs in THIS organization, as Business does
    expect(read("app/(coach)/groups/[groupId]/business/page.tsx")).toContain("headlineMrr(realMRR, estimatedMRR).value");
  });
});

describe("the coach's phone Home", () => {
  const phone = read("components/coach/mobile/coach-mobile-home.tsx");
  it("leaves room under the last row for the fixed bottom tabs", () => {
    expect(phone).toContain('font-body pb-24">');
  });
  it("speaks as a coach, not as the client app: the one big button is the next client's workout", () => {
    expect(phone).not.toContain("Start Workout");
    expect(phone).not.toContain("Log &rarr;");
    expect(phone).toContain("<NextClientWorkoutSection");
    expect(read("components/coach/next-client-workout-section.tsx")).toContain("Start {next.name}&apos;s workout");
  });
});

describe("a quiet client's date reads as a person says it", () => {
  it("'since Sep 6', not 2026-09-06", () => {
    expect(shortDateLabel("2026-09-06")).toBe("Sep 6");
    const src = read("lib/coach-briefing-gather.ts");
    expect(src).toContain("since ${shortDateLabel(lastLoggedAtStr.slice(0, 10))}");
  });
});
