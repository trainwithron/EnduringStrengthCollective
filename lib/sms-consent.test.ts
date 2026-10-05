import { describe, expect, it } from "vitest";
import { parseSmsConsentInput } from "@/lib/sms-consent";

describe("parseSmsConsentInput", () => {
  it("normalizes a typed US number and keeps the chosen scopes", () => {
    expect(parseSmsConsentInput({ phone: "(555) 123-4567", appointments: true, announcements: false })).toEqual({
      ok: true,
      phoneE164: "+15551234567",
      appointments: true,
      announcements: false,
    });
  });

  it("rejects an unusable number", () => {
    const r = parseSmsConsentInput({ phone: "12345", appointments: true, announcements: true });
    expect(r.ok).toBe(false);
  });

  it("requires both choices to be explicit booleans (no default-on)", () => {
    expect(parseSmsConsentInput({ phone: "5551234567", appointments: true }).ok).toBe(false);
    expect(parseSmsConsentInput({ phone: "5551234567", appointments: "yes", announcements: false }).ok).toBe(false);
    expect(parseSmsConsentInput(null).ok).toBe(false);
  });

  it("allows turning both off (an opt-out)", () => {
    expect(parseSmsConsentInput({ phone: "5551234567", appointments: false, announcements: false }).ok).toBe(true);
  });
});
