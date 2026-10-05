import { describe, expect, it } from "vitest";
import {
  buildClaimSms,
  claimStatus,
  generateClaimToken,
  hashClaimToken,
  isPlaceholderEmail,
  placeholderEmailFor,
  smsHref,
} from "@/lib/client-claim";

describe("placeholder emails", () => {
  it("builds an address that can never receive mail and recognizes it", () => {
    const e = placeholderEmailFor("AB12-cd34-ef56-gh78-ij90");
    expect(e).toBe("client-ab12cd34ef56gh78@pending.invalid");
    expect(isPlaceholderEmail(e)).toBe(true);
    expect(isPlaceholderEmail("sawyer@gmail.com")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });
});

describe("claim tokens", () => {
  it("are URL-safe, unique, and only their hash is deterministic", () => {
    const a = generateClaimToken();
    const b = generateClaimToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashClaimToken(a)).toBe(hashClaimToken(a));
    expect(hashClaimToken(a)).not.toBe(hashClaimToken(b));
    expect(hashClaimToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaimToken(a)).not.toContain(a);
  });
});

describe("claimStatus", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const future = "2026-10-10T00:00:00Z";
  const past = "2026-10-01T00:00:00Z";

  it("is active once the client has signed in, whatever the invites say", () => {
    expect(claimStatus({ claimedAt: "2026-09-01T00:00:00Z", latestInvite: null, now })).toBe("active");
    expect(claimStatus({ claimedAt: "2026-09-01T00:00:00Z", latestInvite: { expiresAt: future, usedAt: null }, now })).toBe("active");
  });

  it("shows invite created only while a live, unused link exists", () => {
    expect(claimStatus({ claimedAt: null, latestInvite: { expiresAt: future, usedAt: null }, now })).toBe("invite_created");
    expect(claimStatus({ claimedAt: null, latestInvite: { expiresAt: past, usedAt: null }, now })).toBe("not_signed_in");
    expect(claimStatus({ claimedAt: null, latestInvite: { expiresAt: future, usedAt: "2026-10-05T00:00:00Z" }, now })).toBe("not_signed_in");
    expect(claimStatus({ claimedAt: null, latestInvite: null, now })).toBe("not_signed_in");
  });
});

describe("claim text message", () => {
  it("greets by first name and carries the link; sms href is encoded", () => {
    const body = buildClaimSms("https://app.example/claim/abc", "Sawyer", "Ron");
    expect(body).toContain("Hi Sawyer!");
    expect(body).toContain("https://app.example/claim/abc");
    expect(body.endsWith("— Ron")).toBe(true);
    expect(smsHref(body).startsWith("sms:?&body=")).toBe(true);
    expect(smsHref("a b&c")).toBe("sms:?&body=a%20b%26c");
  });
});
