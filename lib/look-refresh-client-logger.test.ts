import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { barRest, nextExerciseId } from "@/lib/logger-bottom-bar";
import { completingFields } from "@/lib/set-complete";

// Look Refresh, client step (Ron, Nov 20: "I'm good with all of that"): the workout logger, laid out like the ClientWorkout and ClientWorkoutRest boards. Only placement, sizing and style.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const card = read("components/logging/exercise-card.tsx");
const grid = read("components/logging/exercise-set-grid.tsx");
const logger = read("components/logging/session-logger.tsx");
const rest = read("components/session/rest-timer-bar.tsx");
const page = read("app/sessions/[sessionId]/page.tsx");
const complete = read("components/session/complete-workout-button.tsx");

const set = (id: string, order: number, status: "pending" | "completed", targetRestSeconds: number | null = null, restSeconds: number | null = null) =>
  ({ id, setOrder: order, status, targetRestSeconds, restSeconds }) as never;

describe("the demo is a big player at the top of the exercise", () => {
  it("full width, about 16:9, a play button and Tap for full screen; a tap opens the same demo sheet; hidden when the client turned demos off", () => {
    const hero = read("components/logging/demo-hero.tsx");
    expect(hero).toContain("aspect-[16/9.5]");
    expect(hero).toContain("Tap for full screen");
    expect(hero).toContain("onClick={() => (onOpen ? onOpen() : setOpen(true))}");
    expect(hero).toContain("<DemoSheet");
    expect(card.indexOf("<DemoHero")).toBeLessThan(card.indexOf("<h2"));
    expect(card).toContain("{demo && !demosHidden && (");
  });
});

describe("sets are rows: number, lb, reps, RPE, and a done check", () => {
  it("one grid row per set with 48px boxes, the column names on top with their fill dots, a check at the end", () => {
    expect(grid).toContain("data-set-rows");
    expect(grid).toContain("const columns = `2.5rem repeat(${fields.length}, minmax(3.25rem, 1fr)) 3rem`;");
    expect(grid).toContain('className="relative w-full h-12 min-w-0"');
    expect(grid).toContain("<RowHandle field={field} />");
    expect(grid).toContain("<DoneCheck key={`d-${set.id}`}");
  });
  it("the check never marks a set done that is not filled in: it fills what is suggested and the set completes the usual way", () => {
    const accept = grid.slice(grid.indexOf("function acceptSuggested("), grid.indexOf("return (\n    <div>\n      {sets.map((set) => (\n        <SetCompletionSync"));
    expect(accept).toContain("const suggestion = suggestionFor(set, field);");
    expect(accept).toContain("markTouched(set.id);");
    expect(accept).not.toContain('status: "completed"');
    expect(grid).toContain('if (allFilled && set.status !== "completed" && touched) {');
  });
  it("+ Add a set and Form check sit right under the rows; the Sets row (take one off, Edit metrics) under them", () => {
    expect(card).toContain("leading={!readOnly ? <AddSetButton busy={addSetBusy || undoBusy} onAdd={handleAddSet} /> : null}");
    expect(card.indexOf("<ExerciseSetGrid")).toBeLessThan(card.indexOf("<ExerciseVideoThread"));
    const thread = read("components/logging/exercise-video-thread.tsx");
    expect(thread).toContain('<div className="flex items-start gap-2" data-add-set-row>');
    expect(read("components/logging/exercise-video-upload.tsx")).toContain("Form check");
  });
});

describe("a bar at the bottom: Rest on the left, Next on the right", () => {
  it("Rest starts the rest for the next set (the coach's when there is one), Next goes to the next exercise; on the last one it is Finish workout", () => {
    expect(logger).toContain("data-logger-bar");
    expect(logger).toContain("Rest {barRestNow.seconds}s");
    expect(logger).toContain('{nextName ? `Next: ${nextName}` : "Finish workout"}');
    expect(logger).toContain("askWorkoutChoice();");
  });
  it("Next follows a superset or circuit the same way the workout does after a set", () => {
    const ex = (id: string, ...statuses: ("pending" | "completed")[]) => ({ id, sets: statuses.map((s, i) => set(`${id}${i}`, i, s)) });
    const list = [ex("a", "pending"), ex("b", "pending"), ex("c", "pending"), ex("d", "pending")];
    expect(nextExerciseId(list, 0, null)).toBe("b");
    expect(nextExerciseId(list, 3, null)).toBeNull();
    // a and b linked: from b back to a while a has sets left
    expect(nextExerciseId(list, 1, ["a", "b"])).toBe("a");
    const doneA = [ex("a", "completed"), ex("b", "pending"), ex("c", "pending")];
    expect(nextExerciseId(doneA, 1, ["a", "b"])).toBe("c");
  });
  it("the rest is the coach's for the next set, else one the client typed, else 90 seconds", () => {
    expect(barRest([set("s1", 0, "completed", 120), set("s2", 1, "pending")]).seconds).toBe(120);
    expect(barRest([set("s1", 0, "pending", null, 75)]).seconds).toBe(75);
    expect(barRest([set("s1", 0, "pending")]).seconds).toBe(90);
  });
});

describe("Finish is at the top right of the header", () => {
  it("it opens the same choice Complete workout did; the choice opens over the bottom bar only while it is asked", () => {
    expect(page).toContain("<FinishWorkoutButton />");
    expect(read("components/session/finish-workout-button.tsx")).toContain("onClick={askWorkoutChoice}");
    expect(complete).toContain("if (!confirming && longRunSeconds == null && !error && !submitting) return null;");
    expect(complete).toContain("Complete this workout, or pause it and pick it up later.");
  });
});

describe("the rest timer is a sheet from the bottom while it runs", () => {
  it("a big countdown ring, +15s, 60 / 90 / 120, Read and the game, and a big Skip rest", () => {
    expect(rest).toContain('aria-label="Rest timer"');
    expect(rest).toContain('<svg width="120" height="120" viewBox="0 0 120 120" role="img"');
    expect(rest).toContain("+15s");
    expect(rest).toContain("const PRESETS = [60, 90, 120];");
    expect(rest).toContain("🎮 {selectedGame ? \"Hide\" : \"Game\"}");
    expect(rest).toContain("Skip rest");
  });
  it("no -15s, and the coach's rest keeps its rule: no +15s and no other length on it", () => {
    expect(rest).not.toContain("-15s");
    expect(rest).not.toContain("−15s");
    expect(rest).toContain('{running.source !== "coach" && (\n                <button type="button" onClick={addFifteen}');
    expect(rest).toContain('{running.source !== "coach" &&\n              PRESETS.map(');
    expect(rest).toContain('if (!running || running.source === "coach") return;');
  });
  it("the game still waits for a pending habit or check-in", () => {
    expect(rest).toContain("{pendingTask && !taskResolved ? (");
    expect(rest).toContain("Finish this to unlock the mini-game/trivia:");
  });
});

// Assistant review of f46a5c24: the done check fills only what completes the set, focuses only a box that still blocks it, and confirms a pre-filled weight.
describe("the done check", () => {
  it("(a) fills only the fields that complete the set: weight and reps, or the one field of a timed or distance exercise; never RPE, RIR, tempo or rest", () => {
    expect(completingFields(["weight", "reps", "rpe", "rir", "tempo", "rest"], false)).toEqual(["weight", "reps"]);
    expect(completingFields(["weight", "reps", "rpe"], true)).toEqual(["reps"]);
    expect(completingFields(["time", "rpe", "rest"], false)).toEqual(["time"]);
    expect(completingFields(["distance", "pace"], false)).toEqual(["distance"]);
    expect(completingFields(["rest"], false)).toEqual([]);
    expect(grid).toContain("const needed = completingFields(fields, weightOptional);");
    expect(grid).toContain("for (const field of needed) {");
    expect(grid).not.toContain('for (const field of fields) {\n      if (field === "rest") continue;');
  });
  it("(b) focuses only a completing box that has nothing to suggest, never an optional one", () => {
    expect(grid).toContain("const focusField = stillEmpty[0];");
    expect(grid).toContain("document.querySelector<HTMLInputElement>(`[data-set-row=\"${set.id}\"][data-set-field=\"${focusField}\"] input`)?.focus();");
    expect(grid).toContain("data-set-row={set.id} data-set-field={field}");
  });
  it("(c) a pre-filled weight is confirmed when the check completes the set, as leaving the weight box does", () => {
    expect(grid).toContain("if (needed.includes(\"weight\") && !weightConfirmed && set.weight !== null && set.weight !== undefined && !set.weightConfirmed) {");
    expect(grid).toContain("save(set.id, { weight_confirmed: true });");
  });
});

// Assistant review of f46a5c24: the floating nav covered page bottoms on an iPhone home-screen app (its 34px safe area).
describe("page bottoms clear the floating nav", () => {
  it("the bar brings an in-flow spacer its own height; the coach shell, whose bar sits before its page, reserves the room itself", () => {
    const bar = read("components/athlete/bottom-tab-bar.tsx");
    expect(bar).toContain("{spacer && <div aria-hidden=\"true\" data-tab-bar-spacer className=\"h-[calc(5.5rem+env(safe-area-inset-bottom))]\" />}");
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).toContain("<BottomTabBar groupId={groupId} variant=\"own\" activeOverride={null} spacer={false} />");
    expect(shell).toContain("pb-[calc(6.5rem+env(safe-area-inset-bottom))]");
  });
});
