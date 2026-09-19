import { describe, it, expect } from "vitest";
import { parseQuickBuildInput } from "./spot-quick-build";

describe("parseQuickBuildInput", () => {
  it("extracts a plain weeks count", () => {
    expect(parseQuickBuildInput("8-week strength block").weeks).toBe(8);
    expect(parseQuickBuildInput("12 week hypertrophy program").weeks).toBe(12);
  });

  it("returns null weeks when none is mentioned", () => {
    expect(parseQuickBuildInput("squat bench deadlift focus").weeks).toBeNull();
  });

  it("clamps an out-of-range weeks value into 1-16", () => {
    expect(parseQuickBuildInput("99-week block").weeks).toBe(16);
    expect(parseQuickBuildInput("0-week block").weeks).toBe(1);
  });

  it("detects a progression rule keyword, case-insensitively", () => {
    expect(parseQuickBuildInput("Undulating periodization, 6 weeks").progressionRule).toBe("Undulating");
    expect(parseQuickBuildInput("use a DUP scheme").progressionRule).toBe("Undulating");
    expect(parseQuickBuildInput("double progression on all lifts").progressionRule).toBe("Double Progression");
    expect(parseQuickBuildInput("simple linear progression").progressionRule).toBe("Linear");
  });

  it("returns null progressionRule when nothing matches", () => {
    expect(parseQuickBuildInput("a strength block").progressionRule).toBeNull();
  });

  it("detects a known methodology/style keyword", () => {
    expect(parseQuickBuildInput("conjugate style block").style).toBe("Conjugate");
    expect(parseQuickBuildInput("run a westside template").style).toBe("Conjugate");
    expect(parseQuickBuildInput("juggernaut method").style).toBe("Juggernaut");
    expect(parseQuickBuildInput("classic 5/3/1").style).toBe("5/3/1");
    expect(parseQuickBuildInput("531 for the big four").style).toBe("5/3/1");
    expect(parseQuickBuildInput("GZCLP shell").style).toBe("GZCLP");
    expect(parseQuickBuildInput("push pull legs split").style).toBe("Push/Pull/Legs");
  });

  it("returns null style when nothing matches", () => {
    expect(parseQuickBuildInput("8 weeks, upper lower split").style).toBeNull();
  });

  it("extracts all three fields from one realistic sentence", () => {
    const result = parseQuickBuildInput("Conjugate style, 10 weeks, undulating rep scheme for a powerlifter");
    expect(result).toEqual({ weeks: 10, progressionRule: "Undulating", style: "Conjugate" });
  });
});
