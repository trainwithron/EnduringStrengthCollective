import { describe, it, expect } from "vitest";
import { normalizePhoneToE164 } from "./phone";

describe("normalizePhoneToE164", () => {
  it("normalizes a plain 10-digit US number", () => {
    expect(normalizePhoneToE164("5551234567")).toBe("+15551234567");
  });

  it("strips formatting punctuation before normalizing", () => {
    expect(normalizePhoneToE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("keeps an already-prefixed leading 1 without doubling it", () => {
    expect(normalizePhoneToE164("15551234567")).toBe("+15551234567");
  });

  it("passes through an already-international +-prefixed number", () => {
    expect(normalizePhoneToE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects a string with too few digits to be a real number", () => {
    expect(normalizePhoneToE164("12345")).toBeNull();
  });

  it("rejects a +-prefixed number that's too short after stripping", () => {
    expect(normalizePhoneToE164("+1234")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(normalizePhoneToE164("")).toBeNull();
  });

  it("rejects an 11-digit number not starting with country code 1", () => {
    expect(normalizePhoneToE164("25551234567")).toBeNull();
  });
});
