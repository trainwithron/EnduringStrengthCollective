import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Workout logger on a phone (FIX_LOGGER_PHONE steps 2-4 + Ron's approved extras, Oct 20): the dead space between the top and the sets goes, so the sets keep the screen. Source-level guards.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const carousel = read("components/logging/exercise-swipe-carousel.tsx");
const card = read("components/logging/exercise-card.tsx");
const grid = read("components/logging/exercise-set-grid.tsx");
const logger = read("components/logging/session-logger.tsx");

describe("less dead space in the logger", () => {
  it("a one-exercise day's spacer is the dots row's height, not taller", () => {
    expect(carousel).toContain('<div className="h-7 mb-1" aria-hidden="true" />');
    expect(carousel).not.toContain("h-9 mb-3");
  });
  it("Edit metrics and Add weight / RPE ride on the Sets row (after the grid), and their popup opens above it", () => {
    const button = card.search(/>\s*Edit metrics\s*<\/button>/);
    expect(card.match(/>\s*Edit metrics\s*<\/button>/g)?.length).toBe(1);
    expect(button).toBeGreaterThan(card.indexOf("<ExerciseSetGrid"));
    expect(button).toBeGreaterThan(card.indexOf("<SetStepper"));
    expect(card).toContain("trailing={");
    expect(card).toContain("Add weight / RPE");
    expect(card).toContain("{rowAction && <span");
    expect(card).toContain("absolute z-10 right-0 bottom-full mb-1");
  });
  it("the set-number cell is shorter; the cells you type in stay 44 px", () => {
    expect(grid).toContain("w-12 shrink-0 min-h-9 text-center");
    expect(grid).not.toContain("w-12 shrink-0 min-h-11 text-center");
  });
  it("the rest bar, the save banner and the cards share one box, so the bar can open over the card", () => {
    const box = logger.slice(logger.indexOf("<SetSaveProvider>"), logger.indexOf("</SetSaveProvider>"));
    expect(box.indexOf('<div className="relative">')).toBeLessThan(box.indexOf("<RestTimerBar"));
    expect(box.indexOf("</section>\n      </div>")).toBeGreaterThan(box.indexOf("<SetSaveBanner />"));
  });
  it("the coach's own note shows without More room; the plain tip still waits for More room", () => {
    expect(carousel).toContain("{(expanded || coachNoteByExerciseName[exercise.exerciseName]) && (");
    const callout = read("components/logging/exercise-note-callout.tsx");
    expect(callout).toContain("if (coachNote) {");
  });
});
