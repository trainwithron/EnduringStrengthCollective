import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: Confirm & log (typed, barcode, photo) and "I ate this / Skip" did nothing, silently, on a dropped connection, and the estimate was lost from sight.
describe("food logging that does not save", () => {
  for (const f of ["components/athlete/photo-log-food-button.tsx", "components/athlete/barcode-scan-button.tsx", "components/athlete/meal-checkoff-list.tsx"]) {
    it(`${f}: Confirm & log keeps the estimate on screen and says so`, () => {
      const src = read(f);
      const at = src.indexOf("async function handleConfirm()");
      const block = src.slice(at, src.indexOf("\n  }\n", at));
      expect(block).toContain("const { data, error: saveError } = await supabase");
      expect(block).toContain("if (saveError || !data) {");
      expect(block).toContain("That didn't save. Your estimate is still here: check your connection and tap Confirm & log again.");
      expect(block.indexOf("if (saveError || !data)")).toBeLessThan(block.indexOf("onLogged("));
    });
  }
  it("the photo and typed estimate cards show the message", () => {
    expect(read("components/athlete/photo-log-food-button.tsx")).toContain("{error && (");
    expect(read("components/athlete/meal-checkoff-list.tsx")).toContain("Rough estimate — not lab-precise.");
  });
  it("'I ate this' and 'Skip' say so when they did not save", () => {
    const src = read("components/athlete/meal-checkoff-list.tsx");
    expect(src).toContain("if (logSaveError || !data) setLogError(");
    expect(src).toContain("{logError && (");
  });
});
