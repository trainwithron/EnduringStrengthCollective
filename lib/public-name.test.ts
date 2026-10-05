import { describe, expect, it } from "vitest";
import { publicDisplayName } from "./public-name";

describe("publicDisplayName", () => {
  it("shows a first name and last initial", () => {
    expect(publicDisplayName("Alice Athlete")).toBe("Alice A.");
    expect(publicDisplayName("  Mary Jane van der Berg ")).toBe("Mary B.");
  });
  it("copes with one name or none", () => {
    expect(publicDisplayName("Cher")).toBe("Cher");
    expect(publicDisplayName("")).toBe("An athlete");
    expect(publicDisplayName(null)).toBe("An athlete");
  });
});
