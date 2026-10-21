import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { macroAutofill, mismatchLine, withAutofill, type MacroDraft } from "./macro-autofill";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

// Ron, Oct 21: "it needs to automatically fill in the last blank ... I shouldn't have to add them up."
const d = (calories: string, protein: string, carbs: string, fat: string): MacroDraft => ({ calories, protein, carbs, fat });
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the one blank is worked out from the other three", () => {
  it("protein (Ron's example: 2645 kcal, carbs 180, fat 160 -> 121 g)", () => {
    expect(macroAutofill(d("2645", "", "180", "160"))).toEqual({ key: "protein", value: 121, mismatchTotal: null });
  });
  it("carbs, fat and calories", () => {
    expect(macroAutofill(d("2645", "121", "", "160"))).toEqual({ key: "carbs", value: 180, mismatchTotal: null });
    expect(macroAutofill(d("2645", "121", "180", ""))).toEqual({ key: "fat", value: 160, mismatchTotal: null });
    expect(macroAutofill(d("", "121", "180", "160"))).toEqual({ key: "calories", value: 2644, mismatchTotal: null });
  });
  it("rounds to whole grams (and whole calories)", () => {
    // 2000 - 4*150 - 4*200 = 600 / 9 = 66.67
    expect(macroAutofill(d("2000", "150", "200", "")).value).toBe(67);
    // 2001 - 4*150 - 9*60 = 861 / 4 = 215.25
    expect(macroAutofill(d("2001", "150", "", "60")).value).toBe(215);
    expect(macroAutofill(d("", "150.5", "200", "60")).value).toBe(1942);
  });
  it("never below 0 when the other three already pass the calories", () => {
    expect(macroAutofill(d("1500", "", "300", "100"))).toEqual({ key: "protein", value: 0, mismatchTotal: null });
    expect(macroAutofill(d("1000", "200", "200", "")).value).toBe(0);
  });
  it("nothing with two or more blanks, or when one of the other three is not a number", () => {
    expect(macroAutofill(d("2645", "", "", "160")).key).toBeNull();
    expect(macroAutofill(d("", "", "", "")).key).toBeNull();
    expect(macroAutofill(d("abc", "", "180", "160")).key).toBeNull();
    expect(macroAutofill(d("2645", "", "-5", "160")).key).toBeNull();
  });
  it("what is saved is what is shown: the worked-out number fills the blank, a typed one is never changed", () => {
    expect(withAutofill(d("2645", "", "180", "160"))).toEqual(d("2645", "121", "180", "160"));
    expect(withAutofill(d("2645", "130", "180", "160"))).toEqual(d("2645", "130", "180", "160"));
  });
});

describe("all four typed and not adding up", () => {
  it("more than 25 kcal apart: one quiet line with what they add up to", () => {
    // 4*150 + 4*200 + 9*80 = 2120
    const fill = macroAutofill(d("2500", "150", "200", "80"));
    expect(fill).toEqual({ key: null, value: null, mismatchTotal: 2120 });
    expect(mismatchLine(fill)).toBe("These add up to 2,120 calories");
  });
  it("within 25 kcal: nothing", () => {
    expect(mismatchLine(macroAutofill(d("2645", "121", "180", "160")))).toBeNull();
    expect(mismatchLine(macroAutofill(d("2145", "150", "200", "80")))).toBeNull();
    expect(mismatchLine(macroAutofill(d("2146", "150", "200", "80")))).toBe("These add up to 2,120 calories");
  });
});

describe("in the coach's target forms", () => {
  it("the standing target shows the worked-out protein muted, with a small note", async () => {
    const { StandingMacroTargetCard } = await import("@/components/coach/desktop/standing-macro-target-card");
    const html = renderToStaticMarkup(
      createElement(StandingMacroTargetCard, {
        athleteId: "a",
        groupId: "g",
        initial: { calories: 2645, proteinG: null, carbsG: 180, fatG: 160 },
        latestExplicit: null,
        upcomingOverrides: [],
        calendarHref: "/x",
        todayKey: "2026-10-21",
      })
    );
    expect(html).toContain('value="121"');
    expect(html).toContain("(worked out)");
    expect(html).toMatch(/value="121"[^>]*text-steel italic|text-steel italic[^>]*value="121"/);
  });
  it("all three forms that take the four numbers use it, and save the filled values", () => {
    for (const f of ["components/coach/desktop/standing-macro-target-card.tsx", "components/coach/desktop/daily-macros-form.tsx", "components/coach/desktop/bulk-macro-range-form.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("macroAutofill(");
      expect(s, f).toContain("<MacroMismatchLine fill={fill} />");
      // the standing card draws its four fields in one loop
      expect(s.match(/<WorkedOutTag /g)?.length, f).toBe(f.includes("standing") ? 1 : 4);
    }
    expect(read("components/coach/desktop/daily-macros-form.tsx")).toContain("protein_g: filled.protein ? Number(filled.protein) : null,");
    expect(read("components/coach/desktop/bulk-macro-range-form.tsx")).toContain("protein_g: filled.protein ? Number(filled.protein) : null,");
    expect(read("components/coach/desktop/standing-macro-target-card.tsx")).toContain("const raw = filled[f.key].trim();");
  });
});
