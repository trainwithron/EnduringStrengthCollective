import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("components/logging/exercise-set-grid.tsx", "utf8");

describe("touch replacement for swipe-to-accept", () => {
  it("a touch tap on an empty cell with a suggestion takes the suggestion and keeps the keyboard closed", () => {
    expect(src).toContain("const tapAccepts = !readOnly && draft.trim() === \"\" && suggestion != null");
    expect(src).toContain("if (touchTap.current && tapAccepts) e.preventDefault();");
    expect(src).toMatch(/onClick=\{\(\) => \{\s*if \(!touchTap\.current \|\| !tapAccepts \|\| suggestion == null\) return;[\s\S]*?commit\(suggestion\);/);
  });
  it("only touch taps take it (the mouse keeps its swipe) and a filled cell edits normally", () => {
    expect(src).toContain('touchTap.current = e.pointerType === "touch";');
    expect(src).toContain('e.pointerType === "touch") return;');
  });
});
