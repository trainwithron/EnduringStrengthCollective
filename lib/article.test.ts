import { describe, it, expect } from "vitest";
import { withArticle } from "./article";

describe("withArticle", () => {
  it("uses an before a vowel and a before a consonant", () => {
    expect(withArticle("athlete")).toBe("an athlete");
    expect(withArticle("client")).toBe("a client");
    expect(withArticle("Member")).toBe("a Member");
    expect(withArticle("Elite")).toBe("an Elite");
  });
  it("handles an empty word", () => {
    expect(withArticle("  ")).toBe("a");
  });
});
