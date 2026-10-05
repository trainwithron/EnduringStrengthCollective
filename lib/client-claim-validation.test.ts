import { describe, expect, it } from "vitest";
import { CLAIM_LINK_LIFETIME_HOURS, validateClaimEmail, validateNewPassword } from "./client-claim";

describe("claim link lifetime", () => {
  it("is 48 hours", () => {
    expect(CLAIM_LINK_LIFETIME_HOURS).toBe(48);
  });
});

describe("validateClaimEmail", () => {
  it("accepts a matching, well-formed pair (case and spaces ignored)", () => {
    expect(validateClaimEmail(" Sam@Example.com ", "sam@example.com")).toBeNull();
  });
  it("rejects a malformed address", () => {
    expect(validateClaimEmail("sam@", "sam@")).toMatch(/Enter your email/);
    expect(validateClaimEmail("", "")).toMatch(/Enter your email/);
  });
  it("rejects a typo between the two entries", () => {
    expect(validateClaimEmail("sam@example.com", "sam@exmaple.com")).toMatch(/don't match/);
  });
});

describe("validateNewPassword", () => {
  it("needs at least 6 characters", () => {
    expect(validateNewPassword("12345")).not.toBeNull();
    expect(validateNewPassword("123456")).toBeNull();
  });
});
