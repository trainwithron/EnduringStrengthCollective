import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRestAnyForm, restForSet } from "@/lib/rest-time";
import { BULK_NEEDS_TIME, parseBulkValue } from "@/lib/bulk-edit-value";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, in Rob Derrick's AI-built program: Bulk edit week set to a rest time "did not update the rest periods", and asking the AI "60 to 90 seconds" did not change it either. Found: that program has 67 sets and
// none has a rest. (1) The Bulk edit Rest box was a number box: a time it could not read ("1:30", "60 to 90") became blank, and a blank was written onto every set, which CLEARS the rest. (2) The
// builder only listed a field the exercises already track, and the AI gives an exercise a rest only when it wrote one. (3) The AI wrote "60-90s" for a range and a range was never saved.
describe("rest is read the same way everywhere, ranges included", () => {
  it("every way of writing it", () => {
    const cases: [string, number | null][] = [
      ["90", 90], ["90s", 90], ["1:30", 90], ["2 min", 120], ["2m", 120], ["60-90", 90], ["60 to 90", 90], ["60 to 90 seconds", 90], ["60–90s", 90], ["1:00-1:30", 90], ["1 to 2 min", 120], ["45-60 sec", 60],
      ["as needed", null], ["", null], ["abc", null], ["60-", null], ["5-10", null], ["2 to 3", null],
    ];
    for (const [text, seconds] of cases) expect(parseRestAnyForm(text), text).toBe(seconds);
    expect(parseRestAnyForm(null)).toBeNull();
  });
});

describe("Bulk edit reads what was typed, and a blank never clears by accident", () => {
  it("a rest time of any form is read; a range takes the longer end", () => {
    expect(parseBulkValue("rest", "90")).toEqual({ ok: true, blank: false, value: 90 });
    expect(parseBulkValue("rest", "1:30")).toEqual({ ok: true, blank: false, value: 90 });
    expect(parseBulkValue("rest", "60 to 90 seconds")).toEqual({ ok: true, blank: false, value: 90 });
  });
  it("a time it cannot read is an error, never a blank", () => {
    expect(parseBulkValue("rest", "later")).toEqual({ ok: false, message: BULK_NEEDS_TIME });
    expect(parseBulkValue("rest", "2")).toEqual({ ok: false, message: BULK_NEEDS_TIME });
    expect(parseBulkValue("rest", "9999")).toEqual({ ok: false, message: BULK_NEEDS_TIME });
  });
  it("blank is its own case (the coach confirms clearing)", () => {
    expect(parseBulkValue("rest", "  ")).toEqual({ ok: true, blank: true, value: null });
  });
  it("other fields as before", () => {
    expect(parseBulkValue("weight", "135")).toEqual({ ok: true, blank: false, value: 135 });
    expect(parseBulkValue("weight", "x")).toMatchObject({ ok: false });
    expect(parseBulkValue("tempo", " 3010 ")).toEqual({ ok: true, blank: false, value: "3010" });
  });
});

describe("a rest applied in bulk is the rest the logger prescribes", () => {
  it("every set carrying the bulk value gives the timer exactly that rest, from the same column", () => {
    const sets = [0, 1, 2].map((i) => ({ id: `s${i}`, setOrder: i, targetRestSeconds: 90, restSeconds: null }));
    for (const s of sets) expect(restForSet(sets, s.id)).toEqual({ seconds: 90, source: "coach" });
    expect(read("lib/exercise-fields.ts")).toContain('rest: "target_rest_seconds"');
    expect(read("lib/exercise-fields.ts")).toContain('rest: "targetRestSeconds"');
  });
});

describe("the builder and the AI keep the rest", () => {
  const panel = read("components/coach/desktop/bulk-edit-day-panel.tsx");
  it("Rest is always on offer, an exercise without a rest starts tracking it, and the screen shows it at once", () => {
    expect(panel).toContain('"rest" as TrackedField');
    expect(panel).toContain("tracked_fields: [...e.trackedFields, field]");
    expect(panel).toContain("addedField: addField");
    expect(read("components/coach/desktop/day-card.tsx")).toContain("update.addedField && !item.trackedFields.includes(update.field)");
    expect(read("components/coach/desktop/week-grid.tsx")).toContain("update.addedField && !item.trackedFields.includes(update.field)");
  });
  it("the box is a text box for a time, reads it before writing, refuses what it cannot read and asks before clearing", () => {
    expect(panel).toContain('field !== "rest" && field !== "time" ? "number" : "text"');
    expect(panel).toContain("parseBulkValue(field, entry.raw)");
    expect(panel).toContain("Clear ${fieldDef(field).label} on every set?");
    expect(panel).toContain("Type a value to apply.");
  });
  it("the AI day builder reads a range and is told to write the longer end", () => {
    const route = read("app/api/ai/build-day/route.ts");
    expect(route).toContain("parseRestAnyForm(r.rest)");
    expect(route).not.toContain("parseRestSeconds(");
    expect(read("lib/ai-day-run.ts")).toContain('for a range the coach gave ("60 to 90 seconds") write the LONGER end');
  });
});
