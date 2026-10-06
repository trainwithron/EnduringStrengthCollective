import { describe, expect, it } from "vitest";
import { isStillOnboarding } from "@/lib/client-onboarding";

const NOW = new Date("2026-10-10T12:00:00Z");
const base = { joinedAt: "2026-09-01T00:00:00Z", intakeRequired: false, intakeCompleted: false, now: NOW };

describe("isStillOnboarding", () => {
  it("is true while a required intake is unfinished, however long ago they joined", () => {
    expect(isStillOnboarding({ ...base, intakeRequired: true })).toBe(true);
  });
  it("is false once the intake is finished and the first days have passed", () => {
    expect(isStillOnboarding({ ...base, intakeRequired: true, intakeCompleted: true })).toBe(false);
  });
  it("is true for the first three days after joining, then false", () => {
    expect(isStillOnboarding({ ...base, joinedAt: "2026-10-08T13:00:00Z" })).toBe(true);
    expect(isStillOnboarding({ ...base, joinedAt: "2026-10-07T11:00:00Z" })).toBe(false);
  });
  it("treats an existing client with no join date and no intake requirement as settled", () => {
    expect(isStillOnboarding({ ...base, joinedAt: null })).toBe(false);
    expect(isStillOnboarding({ ...base, joinedAt: "not a date" })).toBe(false);
  });
});
