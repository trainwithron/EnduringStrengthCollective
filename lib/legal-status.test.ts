import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { documentsNeedingAcceptance, gateCopy, legalGateAppliesTo } from "@/lib/legal-status";

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

describe("the beta notice version bump (2026-10-08-draft-4)", () => {
  const oldAcceptances = [
    { document: "beta_notice", version: "2026-10-05-draft-3" },
    { document: "terms", version: LEGAL_VERSIONS.terms },
    { document: "privacy", version: "2026-10-05-placeholder-1" },
  ];
  it("asks everyone who accepted draft-3 for the beta notice and the privacy policy (its AI section changed), not the terms", () => {
    expect(LEGAL_VERSIONS.beta_notice).toBe("2026-10-08-draft-4");
    expect(LEGAL_VERSIONS.privacy).toBe("2026-10-08-placeholder-2");
    expect(documentsNeedingAcceptance(oldAcceptances)).toEqual(["beta_notice", "privacy"]);
  });
  it("stops asking once the new versions are accepted, however many old rows remain (history is only ever added to)", () => {
    expect(documentsNeedingAcceptance([...oldAcceptances, current("beta_notice"), current("privacy")])).toEqual([]);
  });
  it("leaves the terms placeholder at its version", () => {
    expect(LEGAL_VERSIONS.terms).toBe("2026-10-05-placeholder-1");
  });
});

describe("gateCopy", () => {
  it("says the beta notice was updated when that is all that changed", () => {
    const c = gateCopy(["beta_notice"]);
    expect(c.heading).toBe("The beta notice was updated");
    expect(c.body).toContain("only be asked again if it changes");
  });
  it("names both when the beta notice and the privacy policy changed (what the 2026-10-08 versions ask for)", () => {
    const c = gateCopy(["beta_notice", "privacy"]);
    expect(c.heading).toBe("The beta notice and privacy policy were updated");
    expect(c.body).toBe("Please read and accept them to continue. You will only be asked again if they change.");
  });
  it("uses the general line for anything else", () => {
    expect(gateCopy(["beta_notice", "terms", "privacy"]).heading).toBe("One quick thing");
    expect(gateCopy(["terms"]).heading).toBe("One quick thing");
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
