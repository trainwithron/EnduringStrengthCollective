import { describe, expect, it } from "vitest";
import { normalizeForLog } from "@/lib/nav-query-log";

const roster = [{ fullName: "Jordan Smith" }, { fullName: "Sam Lee" }];

describe("normalizeForLog", () => {
  it("replaces names on the roster, first or last, with a placeholder", () => {
    expect(normalizeForLog("Open Jordan's profile", roster)).toBe("open {name} profile");
    expect(normalizeForLog("where is smith", roster)).toBe("where is {name}");
  });

  it("collapses a full name into one placeholder", () => {
    expect(normalizeForLog("message Jordan Smith now", roster)).toBe("message {name} now");
  });

  it("removes emails and phone numbers", () => {
    expect(normalizeForLog("text 555-123-4567 or mail sam@example.com", roster)).toBe("text {number} or mail {email}");
  });

  it("keeps ordinary words", () => {
    expect(normalizeForLog("How do I add sessions?", roster)).toBe("how do i add sessions");
  });

  it("caps the length", () => {
    expect(normalizeForLog("word ".repeat(100), roster).length).toBeLessThanOrEqual(200);
  });

  it("works with no roster", () => {
    expect(normalizeForLog("Show my calendar")).toBe("show my calendar");
  });
});
