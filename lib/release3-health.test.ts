import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checked } from "@/lib/checked-write";
import { textHasAllergen } from "@/lib/allergen-check";
import { MIN_ARCHETYPE_FAT_G, computeArchetypeMacros } from "@/lib/macros";
import { consentNoticeBody, needsConsentNotice } from "@/lib/minor-consent-notice";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("checked(): a write is only 'done' when the database says so", () => {
  it("an error is a failure with the given message", async () => {
    expect(await checked(Promise.resolve({ data: null, error: { message: "boom" } }), { message: "Couldn't save." })).toEqual({ ok: false, data: null, error: "Couldn't save." });
  });
  it("a thrown error is a failure too", async () => {
    const r = await checked(Promise.reject(new Error("network")));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("That didn't save. Try again.");
  });
  it("with expectRows, no error but no row (row security quietly refused it) is a failure", async () => {
    expect((await checked(Promise.resolve({ data: [], error: null }), { expectRows: true })).ok).toBe(false);
    expect((await checked(Promise.resolve({ data: null, error: null }), { expectRows: true })).ok).toBe(false);
    expect((await checked(Promise.resolve({ data: [{ id: 1 }], error: null }), { expectRows: true })).ok).toBe(true);
    expect((await checked(Promise.resolve({ data: { id: 1 }, error: null }), { expectRows: true })).ok).toBe(true);
  });
  it("without expectRows an empty result is fine", async () => {
    expect((await checked(Promise.resolve({ data: [], error: null }))).ok).toBe(true);
  });
});

describe("consent and injury controls tell the truth", () => {
  const consent = src("components/coach/minor-consent-control.tsx");
  const injury = src("components/coach/injury-status-toggle.tsx");
  it("consent shows verified only after the save is confirmed, and says so when it failed", () => {
    expect(consent).toContain("expectRows: true");
    expect(consent.indexOf("if (!result.ok) {")).toBeLessThan(consent.indexOf("setVerified(nextVerified);"));
    expect(consent).toContain("Couldn't save the consent. Nothing was changed. Try again.");
  });
  it("the injury setting changes on screen only after the save is confirmed (and the surplus goes back if it failed)", () => {
    expect(injury).toContain("expectRows: true");
    expect(injury).toContain("if (await persist(next, surplusPct)) setIsInjured(next);");
    expect(injury).toContain("setSurplusPct(before)");
    expect(injury).toContain("The injury setting was not changed");
  });
});

describe("macros and allergens", () => {
  it("a carnivore or keto day never gets negative fat when protein already uses the calories", () => {
    for (const archetype of ["carnivore", "keto"] as const) {
      const r = computeArchetypeMacros(600, 250, archetype);
      expect(r.fatG).toBe(MIN_ARCHETYPE_FAT_G);
      expect(r.fatG).toBeGreaterThanOrEqual(0);
    }
    expect(computeArchetypeMacros(2800, 180, "carnivore").fatG).toBeGreaterThan(MIN_ARCHETYPE_FAT_G);
  });
  it("protein shakes, powders and bars are flagged for a dairy allergy; plant ones that say so are not", () => {
    for (const text of ["chocolate protein shake", "1 scoop protein powder", "protein bar (peanut)", "vanilla milkshake"]) expect(textHasAllergen(text, "dairy"), text).not.toBeNull();
    for (const text of ["pea protein powder", "vegan protein shake", "plant based protein bar", "rice protein powder"]) expect(textHasAllergen(text, "dairy"), text).toBeNull();
    expect(textHasAllergen("whey protein powder", "dairy")).not.toBeNull();
  });
});

describe("a child waiting for parental consent is not left waiting in silence", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("is announced for an under-13 without verified consent, never for others", () => {
    expect(needsConsentNotice({ dateOfBirth: "2018-03-01", consentVerified: false, now })).toBe(true);
    expect(needsConsentNotice({ dateOfBirth: "2018-03-01", consentVerified: true, now })).toBe(true); // nothing lets a child under 13 in, so a verified-consent flag changes nothing
    expect(needsConsentNotice({ dateOfBirth: "2012-01-01", consentVerified: false, now })).toBe(false);
    expect(needsConsentNotice({ dateOfBirth: "2013-10-17", consentVerified: false, now })).toBe(true);
    expect(needsConsentNotice({ dateOfBirth: "2013-10-16", consentVerified: false, now })).toBe(false);
    expect(needsConsentNotice({ dateOfBirth: null, consentVerified: false, now })).toBe(false);
  });
  it("says it plainly", () => {
    expect(consentNoticeBody("Sam Lee")).toBe("Sam Lee is under 13, so they cannot use the app: Spotlight Coaching is for people 13 and older.");
    expect(consentNoticeBody(null)).toContain("A client is under 13");
  });
  it("the birthday step asks the server to tell the coach, and the route notifies once a week per coach", () => {
    expect(src("components/intake/birthday-form.tsx")).toContain("/api/intake/minor-consent-notice");
    const route = src("app/api/intake/minor-consent-notice/route.ts");
    expect(route).toContain('type: "minor_consent_needed"');
    expect(route).toContain(".gt(\"created_at\", weekAgo)");
  });
});

describe("closing the account removes the InBody photos and the migration is the one rehearsed", () => {
  it("the paste file exists with the closures", () => {
    const sql = src("supabase/migrations/0382_minors_and_health_closures.sql");
    for (const piece of [
      "training_partner_is_protected",
      "training_partner_profiles_text_limits",
      "limit_training_partner_requests",
      "set_guardian_link_token",
      "mc.verified = true",
      "body_weight_logs_weight_range",
      "allowed_mime_types",
      "minor_consent_needed",
    ]) {
      expect(sql, piece).toContain(piece);
    }
  });
});
