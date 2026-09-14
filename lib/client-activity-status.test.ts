import { describe, expect, it } from "vitest";
import { clientActivityStatus, daysSinceOf } from "./client-activity-status";

describe("daysSinceOf", () => {
  it("returns Infinity for no activity", () => {
    expect(daysSinceOf(null)).toBe(Infinity);
  });

  it("computes whole days since a timestamp", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSinceOf(twoDaysAgo)).toBe(2);
  });
});

describe("clientActivityStatus", () => {
  it("reports no logs yet when null", () => {
    expect(clientActivityStatus(null)).toEqual({ text: "No logs yet", dotClass: "bg-steel" });
  });

  it("reports logged today", () => {
    expect(clientActivityStatus(new Date().toISOString())).toEqual({
      text: "Logged today",
      dotClass: "bg-moss",
    });
  });

  it("reports logged yesterday", () => {
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(clientActivityStatus(yesterday)).toEqual({ text: "Logged yesterday", dotClass: "bg-steel" });
  });

  it("reports N days quiet with a steel dot at the 3-day boundary", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(clientActivityStatus(threeDaysAgo)).toEqual({ text: "3 days quiet", dotClass: "bg-steel" });
  });

  it("reports N days quiet with a rust dot past the 3-day boundary", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(clientActivityStatus(fourDaysAgo)).toEqual({ text: "4 days quiet", dotClass: "bg-rust" });
  });
});
