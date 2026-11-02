import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(__dirname, "..", "app/(coach)/groups/[groupId]/branding/page.tsx"), "utf8");

describe("the Organization page has four tabs, two parts each (Ron, Nov 2: \"these tabs could be condensed down\")", () => {
  it("Team, Branding, Labels, Billing", () => {
    expect(page).toContain('{ key: "team", label: "Team" },');
    expect(page).toContain('{ key: "branding", label: "Branding" },');
    expect(page).toContain('{ key: "labels", label: "Labels" },');
    expect(page).toContain('{ key: "billing", label: "Billing" },');
  });

  it("an old link to one of the eight former tabs opens the tab that holds it", () => {
    for (const [old, home] of [["dispatch", "team"], ["workout-card", "branding"], ["tags", "labels"], ["terminology", "labels"], ["plan", "billing"], ["credits", "billing"]]) {
      expect(page).toMatch(new RegExp(`"?${old}"?: "${home}",`));
    }
    expect(page).toContain('const tab: OrgTab = OLD_TAB_HOME[searchParams.tab ?? ""] ?? "team";');
  });

  it("each part keeps its heading and who may change it", () => {
    for (const title of ["Coach Dispatch", "Tags", "What You Call Things", "Plan & Billing", "Credits", "Branding", "Workout Card"]) expect(page).toContain(`<OrgSection title="${title}"`);
    expect(page).toContain("Only owners and admins can manage client tags.");
    expect(page).toContain("{isOwnerOrAdmin && (\n            <OrgSection title=\"Coach Dispatch\">".replace(/\n/g, page.includes("\r\n") ? "\r\n" : "\n"));
    expect(page).toContain("{showPlanTab && (");
  });
});
