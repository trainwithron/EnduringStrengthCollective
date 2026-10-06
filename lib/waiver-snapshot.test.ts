import { describe, expect, it } from "vitest";
import { buildWaiverSnapshot } from "@/lib/waiver-snapshot";

const base = { organizationName: "Iron Club", defaultText: "DEFAULT TEXT", signedName: "  Sam Lee ", signedAtIso: "2026-10-05T12:00:00.000Z", pdf: null };

describe("buildWaiverSnapshot", () => {
  it("keeps the coach's own wording when there is one", () => {
    const s = buildWaiverSnapshot({ ...base, waiverText: "Custom terms." });
    expect(s).toContain("Custom terms.");
    expect(s).not.toContain("DEFAULT TEXT");
    expect(s).toContain("Signed by typing: Sam Lee");
    expect(s).toContain("Iron Club");
  });
  it("falls back to the built-in template when the coach has not written one", () => {
    expect(buildWaiverSnapshot({ ...base, waiverText: "   " })).toContain("DEFAULT TEXT");
    expect(buildWaiverSnapshot({ ...base, waiverText: null })).toContain("DEFAULT TEXT");
  });
  it("identifies an uploaded PDF by fingerprint and says where the copy is", () => {
    const s = buildWaiverSnapshot({ ...base, waiverText: "ignored", pdf: { path: "org/a.pdf", sha256: "abc123", copyPath: "org/signed/abc123.pdf" } });
    expect(s).toContain("SHA-256: abc123");
    expect(s).toContain("Copy kept at: org/signed/abc123.pdf");
    expect(s).not.toContain("ignored");
  });
  it("says so when no copy could be kept", () => {
    const s = buildWaiverSnapshot({ ...base, waiverText: null, pdf: { path: "org/a.pdf", sha256: "abc123", copyPath: null } });
    expect(s).toContain("could not be kept");
  });
});
