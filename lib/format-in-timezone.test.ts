import { describe, expect, it } from "vitest";
import { formatInTimezone, isValidTimeZone } from "./format-in-timezone";

describe("formatInTimezone", () => {
  // 15:00 UTC on Oct 7 2026 is 8:00 AM in Phoenix (no daylight saving) and 11:00 AM in New York.
  const when = "2026-10-07T15:00:00Z";

  it("shows the time in the person's own zone", () => {
    expect(formatInTimezone(when, "America/Phoenix", "time")).toBe("8:00 AM");
    expect(formatInTimezone(when, "America/New_York", "time")).toBe("11:00 AM");
  });

  it("keeps the same wall-clock time across a daylight saving change", () => {
    expect(formatInTimezone("2027-01-12T16:00:00Z", "America/Los_Angeles", "time")).toBe("8:00 AM");
    expect(formatInTimezone("2026-10-13T15:00:00Z", "America/Los_Angeles", "time")).toBe("8:00 AM");
  });

  it("names the zone when it is unknown so it cannot pass for local time", () => {
    expect(formatInTimezone(when, null, "time")).toBe("3:00 PM UTC");
    expect(formatInTimezone(when, "Not/AZone", "time")).toBe("3:00 PM UTC");
  });

  it("formats a date and a date with time", () => {
    expect(formatInTimezone(when, "America/Phoenix", "date")).toBe("Wed, Oct 7");
    expect(formatInTimezone(when, "America/Phoenix", "dateTime")).toBe("Wed, Oct 7, 8:00 AM");
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("nope")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});
