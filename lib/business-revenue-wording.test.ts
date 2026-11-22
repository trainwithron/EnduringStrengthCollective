import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ron, Nov 21: "Change it to estimated monthly revenue." No "MRR" jargon on the Business page (the phone tile already says "Monthly plans").
describe("Business page: plain words for recurring revenue", () => {
  const src = readFileSync(new URL("../app/(coach)/groups/[groupId]/business/page.tsx", import.meta.url), "utf8");
  it("labels the headline tile Monthly revenue / Estimated monthly revenue, never MRR", () => {
    expect(src).toContain('label={realMRR > 0 ? "Monthly revenue" : "Estimated monthly revenue"}');
    expect(src).not.toMatch(/label=\{[^}]*"(Estimated )?MRR"/);
    expect(src).not.toContain("Income and MRR");
  });
});
