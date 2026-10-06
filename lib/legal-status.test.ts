import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { documentsNeedingAcceptance, legalGateAppliesTo } from "@/lib/legal-status";

const current = (document: string) => ({ document, version: LEGAL_VERSIONS[document as keyof typeof LEGAL_VERSIONS] });

describe("documentsNeedingAcceptance", () => {
  it("asks for everything when nothing was ever accepted", () => {
    expect(documentsNeedingAcceptance([])).toEqual(["beta_notice", "terms", "privacy"]);
  });
  it("asks for nothing when all current versions are accepted", () => {
    expect(documentsNeedingAcceptance([current("beta_notice"), current("terms"), current("privacy")])).toEqual([]);
  });
  it("asks again for a document whose version moved on, and only that one", () => {
    const accepted = [current("beta_notice"), { document: "terms", version: "old-version" }, current("privacy")];
    expect(documentsNeedingAcceptance(accepted)).toEqual(["terms"]);
  });
  it("ignores the waiver and refunds, which are not signup documents", () => {
    expect(documentsNeedingAcceptance([current("waiver"), current("refunds"), current("beta_notice"), current("terms"), current("privacy")])).toEqual([]);
  });
});

describe("legalGateAppliesTo", () => {
  it("leaves the documents, sign-in flows and public pages alone", () => {
    for (const p of ["/", "/terms", "/privacy", "/beta", "/login", "/signup", "/invite/abc", "/set-password", "/book/ron", "/share/123", "/api/legal/accept"]) {
      expect(legalGateAppliesTo(p)).toBe(false);
    }
  });
  it("applies to the signed-in app", () => {
    for (const p of ["/dashboard", "/groups/abc", "/groups/abc/clients", "/intake", "/partners", "/notifications"]) {
      expect(legalGateAppliesTo(p)).toBe(true);
    }
  });
});
