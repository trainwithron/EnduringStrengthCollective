import { describe, expect, it } from "vitest";
import { secretsMatch } from "@/lib/webhook-secret";

describe("secretsMatch", () => {
  it("accepts the exact secret", () => {
    expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects a different one, a prefix and a longer one", () => {
    expect(secretsMatch("s3cret-valuX", "s3cret-value")).toBe(false);
    expect(secretsMatch("s3cret", "s3cret-value")).toBe(false);
    expect(secretsMatch("s3cret-value-and-more", "s3cret-value")).toBe(false);
  });

  it("never matches when nothing was sent", () => {
    expect(secretsMatch(null, "s3cret-value")).toBe(false);
    expect(secretsMatch(undefined, "s3cret-value")).toBe(false);
    expect(secretsMatch("", "s3cret-value")).toBe(false);
  });

  it("an unset secret lets nothing in, even an empty value", () => {
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("anything", undefined)).toBe(false);
    expect(secretsMatch("anything", null)).toBe(false);
    expect(secretsMatch(null, null)).toBe(false);
  });

  it("handles non-ASCII", () => {
    expect(secretsMatch("clé-é", "clé-é")).toBe(true);
    expect(secretsMatch("clé-e", "clé-é")).toBe(false);
  });
});
