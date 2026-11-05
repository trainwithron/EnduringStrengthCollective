import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("a teen waiting on a parent: the checkbox is first on the profile (Ron, Nov 5)", () => {
  it("shows above the tabs while waiting, and in Overview once let in", () => {
    const src = readFileSync("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx", "utf8");
    expect(src).toContain('const guardianWaiting = isTeen && !!guardianStateRow && (guardianStateRow as GuardianStateInfo).state !== "signed";');
    expect(src.indexOf("data-guardian-waiting")).toBeLessThan(src.indexOf('<div id="client-profile-body"'));
    expect(src).toContain("{isTeen && !guardianWaiting && (");
  });
});
