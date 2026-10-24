import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Ron, Oct 23, from real use of the logger: cards stuck halfway on an iPhone, "88 reps", no quick way to take an exercise off today's workout, two post-workout cards, and "let's just
// remove the locks".
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the swipe always lands on a card (iPhone)", () => {
  const c = read("components/logging/exercise-swipe-carousel.tsx");
  it("the snap row has no smooth-scrolling default fighting the snap; each card snaps and stops", () => {
    const row = c.slice(c.indexOf('className="flex items-start overflow-x-auto'), c.indexOf("style={{ scrollbarWidth"));
    expect(row).toContain("snap-x snap-mandatory");
    expect(row).not.toContain("scroll-smooth");
    expect(c).toContain("snap-center snap-always");
  });
  it("the row changes height only once a swipe has come to rest (a height change mid-swipe made iPhone drop the snap)", () => {
    const layout = c.slice(c.indexOf("useLayoutEffect(() => {"), c.indexOf("}, [restIndex, restExerciseId, exercises.length]);"));
    expect(layout).toContain("scroller?.children[restIndex]");
    expect(layout).not.toContain("activeIndex");
    expect(c).toContain("else setRestIndex(index);");
  });
  it("without scrollend (Safari before 18), the scroll stopping or the finger lifting still puts the row on the nearest card", () => {
    expect(c).toContain("export const SETTLE_AFTER_MS = 140;");
    expect(c).toContain("const up = () => {\n      touching = false;\n      later();\n    };");
    expect(c).toContain("if (!touching) later();");
  });
});

describe("tapping a number that is already there selects it, so typing replaces it", () => {
  it("weight, reps and every other filled box in the grid", () => {
    const g = read("components/logging/exercise-set-grid.tsx");
    expect(g).toContain('if (el.value === "") return;');
    expect(g).toContain("el.select();");
    expect(g).toContain("if (document.activeElement === el) el.select();");
    expect(g).toContain("if (selectOnFocus.current) e.preventDefault();");
  });
});

describe("Remove from today", () => {
  it("every exercise card can take its exercise off today's workout; a program exercise asks once and says the program stays", () => {
    const card = read("components/logging/exercise-card.tsx");
    expect(card).toContain("{onDelete && (");
    expect(card).toContain('exercise.isAdded ? "Remove" : "Remove from today"');
    expect(card).toContain("from today's workout? The program stays as it is.");
    // it deletes only this session's exercise row (never the program's), and nothing adds it back
    expect(read("components/logging/session-logger.tsx")).toContain('supabase.from("session_exercises").delete().eq("id", exerciseId)');
  });
});

describe("one card after a workout", () => {
  it("the second summary card is gone; the owner can still customize the one card", () => {
    const page = read("app/share/[postId]/page.tsx");
    expect(page).not.toContain('id="full-workout"');
    expect((page.match(/<section/g) ?? []).length).toBe(2);
    expect(read("components/share/share-actions.tsx")).not.toContain("See full workout");
  });
});

describe("no locks", () => {
  it("the logger has no lock or unlock, and the mechanic is gone", () => {
    const g = read("components/logging/exercise-set-grid.tsx");
    for (const gone of ["<Lock", "LockOpen", "showLock", "locked={", "locked?: boolean", "justUnlocked", "beat this to unlock", "obstacle-lock-pulse", "isExerciseUnlocked"]) expect(g, gone).not.toContain(gone);
    expect(existsSync(join(__dirname, "obstacle-unlock.ts"))).toBe(false);
    expect(read("app/sessions/[sessionId]/page.tsx")).not.toContain("computePriorBest");
  });
});
