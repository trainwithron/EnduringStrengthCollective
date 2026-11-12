import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ron, Nov 12: "the bio tags need to be collapsible and where it says Primarily trains hip extension needs to be fully populated".
describe("exercise library: biomechanical tags", () => {
  const src = readFileSync(join(__dirname, "..", "components/coach/exercise-library-list.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("the list shows the whole Primarily trains sentence (it wraps, never cut off)", () => {
    expect(src).toContain('<p className="font-body text-xs text-steel" data-biomech-summary>{breakdown.summary}</p>');
    expect(src).not.toMatch(/truncate">\{breakdown\.summary\}/);
  });
  it("the editor's full tag list folds away, closed until opened, and says how many are chosen", () => {
    const at = src.indexOf("<details className=\"group\" data-biomech-picker>");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).not.toContain(" open");
    expect(src).toContain('{exTags.length > 0 ? `Edit tags (${exTags.length} chosen)` : "Choose tags"}');
    // the picker sits inside it
    expect(src.indexOf("<BiomechTagPicker", at)).toBeLessThan(src.indexOf("</details>", at));
  });
});
