import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ron, Nov 21: a program already assigned to the coach ("Assigned to: Coach Ron") still offered "Coach Ron (you)" to assign again, which failed.
describe("the assign panel treats the coach like a client who already has the program", () => {
  const src = readFileSync(join(__dirname, "..", "components/coach/desktop/program-assign-panel.tsx"), "utf8");
  it("knows the coach's own id and whether they already have it", () => {
    expect(src).toContain("setMyId(user.id);");
    expect(src).toContain("const meHas = myId !== null && alreadyAssigned.has(myId);");
  });
  it("greys the row out with 'has it' and never assigns it again", () => {
    expect(src).toContain('disabled={meHas} checked={!meHas && selected.has("me")}');
    expect(src).toContain('{meHas ? <span className="text-steel text-xs"> · has it</span> : null}');
    expect(src).toContain('if (selected.has("me") && !meHas) {');
  });
  it("doesn't count the coach in the button when they already have it (Code Chat review)", () => {
    expect(src).toContain('const count = list.length + (selected.has("me") && !meHas ? 1 : 0) + selectedGroups.length;');
  });
});
