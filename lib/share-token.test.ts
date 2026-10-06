import { describe, it, expect, beforeAll } from "vitest";
import { parseShareParam, shareHref, signShareId, verifyShareSignature } from "./share-token";

beforeAll(() => {
  process.env.SHARE_LINK_SECRET = "test-secret-for-share-links";
});

describe("signed workout card links", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  it("signs an id, verifies it, and rejects another id, a changed signature and a missing one", () => {
    const sig = signShareId(id);
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyShareSignature(id, sig)).toBe(true);
    expect(verifyShareSignature("99999999-2222-3333-4444-555555555555", sig)).toBe(false);
    expect(verifyShareSignature(id, sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(verifyShareSignature(id, null)).toBe(false);
    expect(verifyShareSignature(id, "")).toBe(false);
  });
  it("builds and splits the link, and a plain post id has no signature", () => {
    const href = shareHref(id);
    expect(href).toBe(`/share/${id}.${signShareId(id)}`);
    const param = href.replace("/share/", "");
    expect(parseShareParam(param)).toEqual({ id, signature: signShareId(id) });
    expect(parseShareParam(id)).toEqual({ id, signature: null });
  });
  it("a different secret makes a different signature", () => {
    const first = signShareId(id);
    process.env.SHARE_LINK_SECRET = "another-secret";
    expect(signShareId(id)).not.toBe(first);
    process.env.SHARE_LINK_SECRET = "test-secret-for-share-links";
  });
});
