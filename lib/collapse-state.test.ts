import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NONE_COLLAPSED, toggleCollapsed, collapseAll, expandAll, allCollapsed, toggleAll } from "@/lib/collapse-state";

describe("each day opens and closes on its own", () => {
  it("everything starts open", () => {
    expect(NONE_COLLAPSED.size).toBe(0);
  });
  it("opening Day 2 leaves Day 1 open: two days open together", () => {
    // Day 1, Day 2 and Day 3 all collapsed; the coach opens Day 1, then Day 2
    let state: ReadonlySet<string> = collapseAll(["d1", "d2", "d3"]);
    state = toggleCollapsed(state, "d1");
    state = toggleCollapsed(state, "d2");
    expect(state.has("d1")).toBe(false);
    expect(state.has("d2")).toBe(false);
    expect(state.has("d3")).toBe(true);
  });
  it("closing one never touches the others", () => {
    const state = toggleCollapsed(NONE_COLLAPSED, "d2");
    expect([...state]).toEqual(["d2"]);
  });
  it("does not change the set it was given", () => {
    const before = new Set(["d1"]);
    toggleCollapsed(before, "d2");
    expect([...before]).toEqual(["d1"]);
  });
});

describe("Collapse all / Expand all", () => {
  const ids = ["a", "b", "c"];
  it("collapses everything, then expands everything", () => {
    const collapsed = toggleAll(NONE_COLLAPSED, ids);
    expect(allCollapsed(collapsed, ids)).toBe(true);
    const expanded = toggleAll(collapsed, ids);
    expect(expanded.size).toBe(0);
  });
  it("with some open, the button collapses the rest (it offers Expand all only when all are closed)", () => {
    const partly = new Set(["a"]);
    expect(allCollapsed(partly, ids)).toBe(false);
    expect(allCollapsed(toggleAll(partly, ids), ids)).toBe(true);
  });
  it("with nothing to collapse, the button never claims everything is collapsed", () => {
    expect(allCollapsed(NONE_COLLAPSED, [])).toBe(false);
    expect(expandAll().size).toBe(0);
  });
  it("a new exercise or day (not in the set) is open", () => {
    const state = collapseAll(["a", "b"]);
    expect(state.has("brand-new")).toBe(false);
    expect(allCollapsed(state, ["a", "b", "brand-new"])).toBe(false);
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("the builder uses it", () => {
  const week = read("../components/coach/desktop/week-grid.tsx");
  const day = read("../components/coach/desktop/day-card.tsx");
  const card = read("../components/coach/exercise-builder-card.tsx");
  it("the week no longer closes the other days when one opens (no accordion)", () => {
    expect(week).toContain("setCollapsedDayIds((prev) => toggleCollapsed(prev, dayId))");
    expect(week).not.toContain("const next = new Set(days.map((d) => d.id));");
    expect(week).toContain("Collapse all days");
    expect(week).toContain("Expand all days");
  });
  it("each day has Collapse all / Expand all for its exercises", () => {
    expect(day).toContain("toggleAll(prev, exerciseIds)");
    expect(day).toContain('"Expand all" : "Collapse all"');
    expect(day).toContain("collapsed={collapsedExerciseIds.has(item.id)}");
  });
  it("the card is controlled by its day when given the state, and still works alone", () => {
    expect(card).toContain("collapsedProp ?? ownCollapsed");
    expect(card).toContain("if (onToggleCollapse) onToggleCollapse();");
  });
  it("a collapsed card shows the WHOLE name (wrapping, never cut off) and what is prescribed, and stays tappable at 44 px", () => {
    const start = card.indexOf("{collapsed ? (");
    const collapsedBlock = card.slice(start, card.indexOf(") : (", start));
    expect(collapsedBlock).toContain("break-words");
    expect(collapsedBlock).not.toContain("truncate");
    expect(collapsedBlock).toContain("min-h-11");
    expect(collapsedBlock).toContain("summarizeSets(exercise.sets, exercise.trackedFields)");
    expect(collapsedBlock).toContain("title={exercise.displayName ?")
  });
  it("drag handle, copy and delete are still on the controls row in the collapsed card", () => {
    const controls = card.slice(card.indexOf('<div className="flex items-center gap-1 mb-1">'), card.indexOf("The name has the card's full width"));
    expect(controls).toContain("GripVertical");
    expect(controls).toContain('aria-label="Duplicate exercise"');
    expect(controls).toContain('aria-label="Delete exercise"');
    expect(controls).not.toContain("!collapsed");
  });
});
