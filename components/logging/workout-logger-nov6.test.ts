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

  it("a done set shows a tick beside its green number", () => {
    expect(grid).toContain('{done && <span aria-hidden="true"> &#10003;</span>}');
  });

  it("sets wrap four to a row, and a cell's error shows under the grid instead of inside the scroll box", () => {
    expect(grid).toContain("const SETS_PER_ROW = 4;");
    expect(grid).not.toContain("overflow-x-auto -mx-1 px-1");
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

  it("Next: is a button that goes to the next exercise", () => {
    expect(read("components/logging/session-progress-strip.tsx")).toContain('document.querySelector(`[data-exercise-id="${next.id}"]`)');
  });
});
