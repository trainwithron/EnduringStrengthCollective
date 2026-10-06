import { describe, it, expect } from "vitest";
import { appendedNote, bumpedReps, parseStep, raisedTarget } from "./progress-apply";

describe("applying an option to the next workout", () => {
  it("raises a set's target by the step, from its own target or from what the client has been lifting", () => {
    expect(raisedTarget(225, 225, 5)).toBe(230);
    expect(raisedTarget(null, 225, 5)).toBe(230);
    expect(raisedTarget(100, 100, 2.5)).toBe(102.5);
  });
  it("adds a rep to a plain number or both ends of a range, and leaves anything else alone", () => {
    expect(bumpedReps("8", 1)).toBe("9");
    expect(bumpedReps("8-10", 1)).toBe("9-11");
    expect(bumpedReps("8 to 10", 1)).toBe("9-11");
    expect(bumpedReps("AMRAP", 1)).toBeNull();
    expect(bumpedReps("30s", 1)).toBeNull();
    expect(bumpedReps(null, 1)).toBeNull();
  });
  it("adds the drafted line to the notes without replacing them, and not twice", () => {
    expect(appendedNote(null, "Pause 1 second at the bottom.")).toBe("Pause 1 second at the bottom.");
    expect(appendedNote("Brace first.", "Pause 1 second at the bottom.")).toBe("Brace first.\nPause 1 second at the bottom.");
    expect(appendedNote("Pause 1 second at the bottom.", "Pause 1 second at the bottom.")).toBe("Pause 1 second at the bottom.");
    expect(appendedNote("Brace first.", "   ")).toBe("Brace first.");
  });
  it("reads a typed step and refuses nonsense", () => {
    expect(parseStep("+5")).toBe(5);
    expect(parseStep(" 2.5 ")).toBe(2.5);
    expect(parseStep("+ 10")).toBe(10);
    expect(parseStep("abc")).toBeNull();
    expect(parseStep("-5")).toBeNull();
    expect(parseStep("0")).toBeNull();
  });
});
