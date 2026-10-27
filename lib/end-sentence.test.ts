import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endSentence, periodAfter } from "./end-sentence";

// Oct 27, phone walkthrough: "Programs of Enduring Strength Co.. Change organization". A name that already ends a sentence keeps its own period.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a sentence that ends with a name", () => {
  it("adds a period only when the name does not end with one", () => {
    expect(`Programs of Enduring Strength Co${periodAfter("Enduring Strength Co")}`).toBe("Programs of Enduring Strength Co.");
    expect(`Programs of Enduring Strength Co.${periodAfter("Enduring Strength Co.")}`).toBe("Programs of Enduring Strength Co.");
    expect(periodAfter("Lee County West Trojans")).toBe(".");
    expect(periodAfter("Wow!")).toBe("");
    expect(periodAfter("Really? ")).toBe("");
    expect(periodAfter(null)).toBe(".");
    expect(endSentence("You are part of Enduring Strength Co.")).toBe("You are part of Enduring Strength Co.");
    expect(endSentence("You are part of Coast2Coast Fitness")).toBe("You are part of Coast2Coast Fitness.");
  });

  it("every sentence that ended with an organization's name uses it", () => {
    const programs = read("app/(coach)/programs/page.tsx");
    expect(programs.match(/\{anchor\.orgName\}<\/span>\{periodAfter\(anchor\.orgName\)\}/g)).toHaveLength(2);
    expect(programs).not.toContain("{anchor.orgName}</span>.");
    expect(read("components/org/leave-organization-control.tsx")).toContain("You are part of {organizationName}{periodAfter(organizationName)}</p>");
    expect(read("components/coach/start-own-account-button.tsx")).toContain("This ends your time with ${organizationName}${periodAfter(organizationName)}`");
    expect(read("lib/leaving-coach-notify.ts")).toContain("You are leaving ${a.orgName}${periodAfter(a.orgName)} Your clients");
  });
});
