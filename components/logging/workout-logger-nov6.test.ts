import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("workout logger fixes (Nov 6)", () => {
  const grid = read("components/logging/exercise-set-grid.tsx");
  const card = read("components/logging/exercise-card.tsx");

  it("sets typed into Wing it / Quick add count as done once filled, without starting a rest", () => {
    expect(card).toContain("arrivedDone={!!exercise.isAdded}");
    expect(grid).toContain("touched={arrivedDone || touchedSetIds.has(set.id)}");
    expect(card).toContain("&& !arrived) {");
  });

  // Look Refresh (client step, Nov 20): the tick is at the end of the set's row now (a green check), and the number still turns green.
  it("a done set shows a green tick at the end of its row and a green number", () => {
    expect(grid).toContain("aria-label={`Set ${setNumber} done`}");
    expect(grid).toContain('const doneMark = done ? "text-moss font-bold" : "";');
  });

  // Ron, Nov 12: a fifth set wrapping onto a second row "needs to scroll". Every set is on one line that scrolls sideways inside the grid (contained, so it never flips to the next
  // exercise), with the row names and fill handles fixed on the left.
  it("sets stay on one line that scrolls sideways, and a cell's error shows under the grid instead of inside the scroll box", () => {
    expect(grid).not.toContain("SETS_PER_ROW");
    expect(grid).toContain('className="overflow-x-auto overscroll-x-contain -mx-1 px-1" data-set-scroll');
    expect(grid).toContain("{sets.map((set, i) => {");
    expect(grid).toContain("onInvalid={(message) => setCellInvalid(");
  });

  it("weights show in the person's unit: the row label, Last time and the strip", () => {
    expect(grid).toContain('f === "weight" ? liftUnitLabel(unit)');
    expect(card).toContain("Last time: {formatLift(lastTime.weight, unit)}");
    expect(read("components/logging/session-progress-strip.tsx")).toContain("formatLift(last.weight, unit)");
  });

  it("Quick add is not offered on a Wing it workout, and reads like the Wing it box", () => {
    expect(read("components/logging/session-logger.tsx")).toContain("{!isOwnSession && !wingIt && (");
    const qa = read("components/logging/quick-add-nl-button.tsx");
    expect(qa).toContain('"Read it"');
    expect(qa).toContain('"Yes, add them"');
    expect(qa).toContain("Not these");
    expect(qa).toContain("That didn't go through. Check your signal and try again.");
  });

  // Look Refresh (client step): Next is on the workout's bottom bar.
  it("Next: is a button that goes to the next exercise", () => {
    expect(read("components/logging/session-logger.tsx")).toContain('document.querySelector(`[data-exercise-id="${nextId}"]`)');
  });
});
