import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: "+ Set" and "Add exercise" did nothing, silently, on a weak signal.
describe("+ Set", () => {
  const card = read("components/logging/exercise-card.tsx");
  it("says so when the set could not be added (a failed insert or a dropped connection), and clears the message on the next try", () => {
    expect(card).toContain("const { data: set, error: addError } = await supabase");
    expect(card).toContain("if (addError || !set) setAddSetError(");
    expect(card).toContain("} catch {\n      setAddSetError(");
    expect(card).toContain("setAddSetError(null);");
    expect(card).toContain("{addSetError && (");
    expect(card).toContain("Couldn't add the set. Check your signal and tap + again.");
  });
});

describe("Add exercise", () => {
  const logger = read("components/logging/session-logger.tsx");
  it("an exercise whose first set did not save is taken off again and the person is told", () => {
    expect(logger).toContain("const { data: sets, error: setsError } = await supabase");
    expect(logger).toContain("if (setsError || !sets || sets.length === 0) {");
    expect(logger).toContain('await saved(supabase.from("session_exercises").delete().eq("id", sessionExercise.id));');
    expect(logger.indexOf("if (setsError || !sets")).toBeLessThan(logger.indexOf("setExercises((prev) => [\n        ...prev,"));
  });
  it("a dropped connection also gets the message", () => {
    expect(logger).toContain('} catch {\n      setAddNameProblem("Couldn\'t add that exercise. Check your signal and try again.");');
  });
});
