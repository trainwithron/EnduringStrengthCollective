import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capitalizeWords } from "./exercise-name-case";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("a typed exercise name capitalizes each word and changes nothing else", () => {
  it('"bech press" -> "Bech Press", "wall sit" -> "Wall Sit", "dumbbell" -> "Dumbbell"', () => {
    expect(capitalizeWords("bech press")).toBe("Bech Press");
    expect(capitalizeWords("wall sit")).toBe("Wall Sit");
    expect(capitalizeWords("dumbbell row")).toBe("Dumbbell Row");
  });
  it("letters already capitalized stay exactly as typed", () => {
    expect(capitalizeWords("RFESS")).toBe("RFESS");
    expect(capitalizeWords("DB bench")).toBe("DB Bench");
    expect(capitalizeWords("rdl")).toBe("Rdl");
    expect(capitalizeWords("RDL")).toBe("RDL");
    expect(capitalizeWords("Push-up")).toBe("Push-up");
    expect(capitalizeWords("push-up")).toBe("Push-up");
  });
  it("spacing, numbers and the empty name are left alone", () => {
    expect(capitalizeWords("")).toBe("");
    expect(capitalizeWords("3 way lunge")).toBe("3 Way Lunge");
    expect(capitalizeWords("front  squat")).toBe("Front  Squat");
  });
});

describe("where it is applied", () => {
  it("a typed name when it is committed, but never a name that was not changed, nor a library or alias pick", () => {
    const input = read("components/coach/exercise-name-input.tsx");
    expect(input).toContain("onCommit?.(text === valueAtFocusRef.current ? text : capitalizeWords(text))");
    expect(input).toContain("else pick(capitalizeWords(trimmed));");
    expect(input).toContain("if (alias) onCommit?.(name, alias);");
    expect(input).toContain("else onCommit?.(name);");
  });
  it("the quick-add line: a new exercise is capitalized, a library exercise keeps its own casing", () => {
    const card = read("components/coach/desktop/day-card.tsx");
    expect(card).toContain("prefixMatches[0] : capitalizeWords(typedName)");
    expect(card).toContain("if (match.exerciseName) return match.exerciseName;");
  });
});
