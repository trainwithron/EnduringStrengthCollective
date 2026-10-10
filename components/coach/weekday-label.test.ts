import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the repeat label keeps the weekday capitalised", () => {
  it('reads "Repeats Mondays", not "Repeats mondays"', () => {
    const form = read("components/coach/series-schedule-form.tsx");
    expect(form).toContain("{weekdayName}</span>}</legend>");
    expect(form).not.toContain("weekdayName.toLowerCase()");
    expect(form).toMatch(/const WEEKDAYS = \["Sundays", "Mondays"/);
  });
  it("the other places that print a repeat weekday use the capitalised list too", () => {
    expect(read("components/coach/client-series-panel.tsx")).toMatch(/const WEEKDAYS = \["Sundays", "Mondays"/);
  });
});
