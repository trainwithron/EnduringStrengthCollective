import { describe, expect, it } from "vitest";
import { clampApplyFrom, maxApplyFromKey, shortDateLabel, targetChangeMessage } from "@/lib/apply-from";

describe("apply from", () => {
  it("defaults to today and never goes into the past", () => {
    expect(clampApplyFrom(null, "2026-10-07")).toBe("2026-10-07");
    expect(clampApplyFrom("", "2026-10-07")).toBe("2026-10-07");
    expect(clampApplyFrom("garbage", "2026-10-07")).toBe("2026-10-07");
    expect(clampApplyFrom("2026-10-01", "2026-10-07")).toBe("2026-10-07");
    expect(clampApplyFrom("2026-10-07", "2026-10-07")).toBe("2026-10-07");
  });
  it("allows up to 14 days ahead and holds anything later at the 14th day", () => {
    expect(maxApplyFromKey("2026-10-07")).toBe("2026-10-21");
    expect(clampApplyFrom("2026-10-21", "2026-10-07")).toBe("2026-10-21");
    expect(clampApplyFrom("2026-10-22", "2026-10-07")).toBe("2026-10-21");
    expect(clampApplyFrom("2027-01-01", "2026-10-07")).toBe("2026-10-21");
  });
  it("counts across a month and a year end, and a leap day", () => {
    expect(maxApplyFromKey("2026-12-25")).toBe("2027-01-08");
    expect(maxApplyFromKey("2028-02-20")).toBe("2028-03-05");
  });
  it("labels a date by its own parts", () => {
    expect(shortDateLabel("2026-10-14")).toBe("Oct 14");
    expect(shortDateLabel("2026-01-05")).toBe("Jan 5");
    expect(shortDateLabel("nope")).toBe("nope");
  });
  it("tells the client the date only when the change starts later", () => {
    expect(targetChangeMessage(2180, "2026-10-07", "2026-10-07")).toBe("Your daily target is now 2,180 calories");
    expect(targetChangeMessage(2180, "2026-10-14", "2026-10-07")).toBe("Your daily target is now 2,180 calories, from Oct 14");
    expect(targetChangeMessage(null, "2026-10-14", "2026-10-07")).toBe("Your daily target has changed, from Oct 14");
  });
});
