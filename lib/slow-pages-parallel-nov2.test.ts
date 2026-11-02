import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// Nov 2 walk-through: three pages made their database reads one after another. Independent reads now go together.
describe("the slow pages read in waves, not one at a time", () => {
  it("Team performance: three waves (group and roster; hero, logs, wellness, RPE, habits; habit logs)", () => {
    const src = read("app/(coach)/groups/[groupId]/team-performance/page.tsx");
    expect(src).toContain("const [{ data: group }, { data: memberRows }] = await Promise.all([");
    expect(src).toContain("const [heroData, { data: logRows }, { data: wellnessRows }, { data: rpeRows }, { data: habitRows }] = await Promise.all([");
    expect(src.match(/await supabase\n?\s*\.from\(/g) ?? []).toHaveLength(2); // the coach check and the habit logs (which need the habits)
  });
  it("Revenue splits: members, pending invitations, rates and challenges together", () => {
    const src = read("app/(coach)/groups/[groupId]/revenue-splits/page.tsx");
    expect(src).toContain("const [{ data: memberRows }, notAccepted, monthlyRateCents, { data: orgChallengeRows }] = await Promise.all([");
    expect(src).toContain("const challengeRows = (orgChallengeRows ?? []).filter((c) => coachIds.has(c.coach_id as string));");
  });
  it("Kiosk settings: group, roster and PIN status together", () => {
    expect(read("app/(coach)/groups/[groupId]/kiosk/settings/page.tsx")).toContain("const [{ data: group }, { data: memberships }, pinStatus] = await Promise.all([");
  });
});
