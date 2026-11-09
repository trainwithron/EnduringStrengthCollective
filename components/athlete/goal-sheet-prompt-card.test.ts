import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, Nov 9: the goal sheet is prompted to clients when they sign in.
describe("the goal sheet prompt on a client's Home", () => {
  const page = read("app/(coach)/groups/[groupId]/page.tsx");
  it("only asks a real client, and only until a sheet is filled in", () => {
    expect(page).toContain("if (!isCoach && !isActingAsOther) {");
    expect(page).toContain("goalSheetNeeded = !sheetError && !sheetRow?.filled_at;");
  });
  it("comes first on Home and opens the sheet itself", () => {
    expect(page.indexOf("<GoalSheetPromptCard")).toBeLessThan(page.indexOf("<AboutYouCard"));
    expect(read("components/athlete/goal-sheet-prompt-card.tsx")).toContain("/goal#goal-sheet");
    expect(read("components/shared/goal-sheet-section.tsx")).toContain('id="goal-sheet"');
  });
});
