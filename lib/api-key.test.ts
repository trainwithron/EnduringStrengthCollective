import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./api-key";

describe("generateApiKey", () => {
  it("generates a 64-character hex string (32 bytes)", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different key on every call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

describe("hashApiKey", () => {
  it("is deterministic — the same input always hashes the same", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces a different hash for a different key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
  });

  it("never returns the plaintext key itself", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).not.toBe(key);
  });
});
