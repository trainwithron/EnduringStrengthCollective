import { describe, expect, it, beforeAll } from "vitest";
import { checkEmailProof, checkFormToken, emailCodeIsValid, emailCodeNow, signEmailProof, signFormToken } from "@/lib/public-booking-proof";

beforeAll(() => {
  process.env.PUBLIC_BOOKING_SECRET = "test-secret-for-proofs";
});

const T0 = 1_800_000_000_000;

describe("form token", () => {
  it("is accepted after a few seconds and before it goes stale", () => {
    const token = signFormToken("ron", T0);
    expect(checkFormToken(token, "ron", T0 + 10_000)).toEqual({ ok: true, issuedMs: T0 });
    expect(checkFormToken(token, "ron", T0 + 5 * 3600 * 1000).ok).toBe(true);
  });
  it("is refused when it comes back too fast, too late, for another page, forged, or missing", () => {
    const token = signFormToken("ron", T0);
    expect(checkFormToken(token, "ron", T0 + 1000).ok).toBe(false);
    expect(checkFormToken(token, "ron", T0 + 7 * 3600 * 1000).ok).toBe(false);
    expect(checkFormToken(token, "sam", T0 + 10_000).ok).toBe(false);
    expect(checkFormToken(`${T0 - 100000}.${token.split(".")[1]}`, "ron", T0 + 10_000).ok).toBe(false);
    expect(checkFormToken(undefined, "ron", T0 + 10_000).ok).toBe(false);
    expect(checkFormToken("garbage", "ron", T0 + 10_000).ok).toBe(false);
  });
});

describe("email code", () => {
  it("is six digits and works for the address and page it was made for", () => {
    const code = emailCodeNow("ron", "a@b.co", T0);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(emailCodeIsValid("ron", "a@b.co", code, T0 + 60_000)).toBe(true);
  });
  it("still works just after the 15-minute bucket changes, but not much later", () => {
    const code = emailCodeNow("ron", "a@b.co", T0);
    expect(emailCodeIsValid("ron", "a@b.co", code, T0 + 20 * 60_000)).toBe(true);
    expect(emailCodeIsValid("ron", "a@b.co", code, T0 + 40 * 60_000)).toBe(false);
  });
  it("does not work for another address or page, or when malformed", () => {
    const code = emailCodeNow("ron", "a@b.co", T0);
    expect(emailCodeIsValid("ron", "x@b.co", code, T0)).toBe(false);
    expect(emailCodeIsValid("sam", "a@b.co", code, T0)).toBe(false);
    expect(emailCodeIsValid("ron", "a@b.co", "12345", T0)).toBe(false);
    expect(emailCodeIsValid("ron", "a@b.co", 123456, T0)).toBe(false);
  });
});

describe("email proof", () => {
  it("is accepted for the same page and address within 30 minutes", () => {
    const proof = signEmailProof("ron", "a@b.co", T0);
    expect(checkEmailProof(proof, "ron", "a@b.co", T0 + 29 * 60_000)).toBe(true);
  });
  it("is refused after it expires, for another address or page, or when forged", () => {
    const proof = signEmailProof("ron", "a@b.co", T0);
    expect(checkEmailProof(proof, "ron", "a@b.co", T0 + 31 * 60_000)).toBe(false);
    expect(checkEmailProof(proof, "ron", "x@b.co", T0 + 60_000)).toBe(false);
    expect(checkEmailProof(proof, "sam", "a@b.co", T0 + 60_000)).toBe(false);
    expect(checkEmailProof(`${T0 + 60 * 60_000}.${proof.split(".")[1]}`, "ron", "a@b.co", T0 + 60_000)).toBe(false);
    expect(checkEmailProof(undefined, "ron", "a@b.co", T0)).toBe(false);
  });
});
