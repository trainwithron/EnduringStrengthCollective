import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: a client whose coach does not set macros or a meal plan was told "Your coach is still setting up your meal plan" forever.
describe("a client with macros switched off", () => {
  const page = read("app/(coach)/groups/[groupId]/nutrition/page.tsx");
  it("the page reads the coach's 'no macros' switch on its own and treats a missing column as on", () => {
    expect(page).toContain('.select("coach_sets_macros")');
    expect(page).toContain("const coachSetsMacros = (macrosRow as { coach_sets_macros?: boolean | null } | null)?.coach_sets_macros !== false;");
  });
  it("tells the food log not to promise a meal plan or target", () => {
    expect(page).toContain("coachProgramming={macrosEnabled && coachSetsMacros}");
  });
  it("the empty meal checklist (with its promise) is drawn only when the coach does programming", () => {
    const section = read("components/athlete/food-log-section.tsx");
    expect(section).toContain(") : coachProgramming ? (");
    expect(section).toContain(") : null}");
    expect(read("components/athlete/meal-checkoff-list.tsx")).toContain("Your coach is still setting up your meal plan.");
  });
});
