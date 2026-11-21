import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBulkValue } from "./bulk-edit-value";
import { WEIGHT_CELL_MESSAGE } from "./cell-write";

// Wave 2 T3 review (Code Chat): Bulk edit reads a weight the same way the single box does, "75%" included, and refuses a typo instead of clearing every set.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("bulk edit's weight", () => {
  it("a fixed weight or a percent of max; a typo is refused with the same words as the single box", () => {
    expect(parseBulkValue("weight", "185")).toEqual({ ok: true, blank: false, value: 185, pctMax: null });
    expect(parseBulkValue("weight", "75%")).toEqual({ ok: true, blank: false, value: "75%", pctMax: 75 });
    for (const typo of ["abc", "200%", "75 lb"]) expect(parseBulkValue("weight", typo)).toEqual({ ok: false, message: WEIGHT_CELL_MESSAGE });
    expect(parseBulkValue("weight", "")).toEqual({ ok: true, blank: true, value: null });
  });
  it("writes the percent and clears the fixed weight (and the other way round), and the builder shows it", () => {
    const panel = read("components/coach/desktop/bulk-edit-day-panel.tsx");
    expect(panel).toContain("? { target_weight: pctMax != null ? null : parsed, target_pct_max: pctMax }");
    expect(panel).toContain('field !== "weight" ? "number" : "text"');
    for (const f of ["components/coach/desktop/day-card.tsx", "components/coach/desktop/week-grid.tsx"]) {
      expect(read(f)).toContain('...(update.field === "weight" ? { targetPctMax: update.pctMax ?? null } : {})');
    }
  });
});

describe("the single weight box", () => {
  it("a typo says why and saves nothing (the box goes back)", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card.match(/if \(!write\) \{\s*flashSaveError\(field === "weight" \? WEIGHT_CELL_MESSAGE : "That isn't a value this box can save\."\);\s*return false;\s*\}/g)?.length).toBe(2);
  });
});
