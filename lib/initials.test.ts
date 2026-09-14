import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Jane Doe")).toBe("JD");
  });

  it("uppercases lowercase input", () => {
    expect(initialsOf("jane doe")).toBe("JD");
  });

  it("handles a single word", () => {
    expect(initialsOf("Cher")).toBe("C");
  });

  it("handles an empty string", () => {
    expect(initialsOf("")).toBe("");
  });

  it("ignores words past the first two", () => {
    expect(initialsOf("Jane Middle Doe")).toBe("JM");
  });
});
