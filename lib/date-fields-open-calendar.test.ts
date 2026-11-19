import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// Ron, Nov 19: "when i try to block time off it should pop up a calendar".
describe("date boxes open their calendar on a click", () => {
  it("one listener in the root layout opens the calendar of any date box that is clicked", () => {
    expect(read("app/layout.tsx")).toContain("<DateFieldsOpenCalendar />");
    const c = read("components/shared/date-fields-open-calendar.tsx");
    expect(c).toContain('new Set(["date", "datetime-local", "month", "week"])');
    expect(c).toContain("el.showPicker?.();");
    expect(c).toContain("el.disabled || el.readOnly");
    // Review: a phone opens its own picker on a tap, so only a mouse click calls it; capture phase.
    expect(c).toContain('pointerType !== "mouse"');
    expect(c).toContain('document.addEventListener("click", onClick, true);');
  });
  it("the Block time off boxes are date boxes, so they get it", () => {
    expect(read("components/coach/desktop/availability-exceptions-manager.tsx")).toContain('type="datetime-local"');
  });
});
