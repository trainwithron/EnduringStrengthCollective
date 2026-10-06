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
    expect(normalizeForLog("word ".repeat(100), roster).length).toBeLessThanOrEqual(120);
  });

  it("works with no roster", () => {
    expect(normalizeForLog("Show my calendar")).toBe("show my calendar");
  });

  it("removes links, handles and capitalized names the roster does not know", () => {
    expect(normalizeForLog("send this to Maria Lopez at https://example.com/x or @maria_l")).toBe("send this to {name} at {link} or {handle}");
  });

  it("removes ids and mixed letter-digit tokens", () => {
    expect(normalizeForLog("my code is a1b2c3d4e5 and sk12345")).toBe("my code is {word} and {word}");
    expect(normalizeForLog("abcdefghijklmnopqrstuvwxyz")).toBe("{word}");
  });

  it("keeps the first word of a sentence even when capitalized", () => {
    expect(normalizeForLog("Where do I add a client")).toBe("where do i add a client");
  });
});
