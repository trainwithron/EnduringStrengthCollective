import { describe, it, expect } from "vitest";
import { firstNameOf, mergeFirstName } from "./broadcast-merge";

describe("firstNameOf", () => {
  it("takes the first word of a full name", () => {
    expect(firstNameOf("Karina Ramirez")).toBe("Karina");
    expect(firstNameOf("  Ben   Carter ")).toBe("Ben");
  });
  it("falls back to 'there' for blank or missing names", () => {
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf("   ")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf(undefined)).toBe("there");
  });
});

describe("mergeFirstName", () => {
  it("replaces every occurrence of the token", () => {
    expect(mergeFirstName("Hey {first_name}, {first_name}!", "Alice Athlete")).toBe("Hey Alice, Alice!");
  });
  it("leaves a message with no token untouched", () => {
    expect(mergeFirstName("Out of town this week.", "Alice Athlete")).toBe("Out of town this week.");
  });
  it("uses the fallback when the name is blank", () => {
    expect(mergeFirstName("Hey {first_name}, hi.", "")).toBe("Hey there, hi.");
  });
  it("does not treat other braces as tokens", () => {
    expect(mergeFirstName("{name} {first_name}", "Ron Arnold")).toBe("{name} Ron");
  });
});
