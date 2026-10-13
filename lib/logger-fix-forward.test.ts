import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "it also needs to fit on the page instead of half of each." One exercise card is exactly the screen wide (no neighbour showing at an edge), the card and the pinned Complete workout bar fit the height
// with no page scroll, and a long card scrolls inside itself. Checked in a real phone viewport (375x812 and 360x640) as well as here.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const carousel = read("components/logging/exercise-swipe-carousel.tsx");
const grid = read("components/logging/exercise-set-grid.tsx");
const logger = read("components/logging/session-logger.tsx");
const page = read("app/sessions/[sessionId]/page.tsx");
const card = read("components/logging/exercise-card.tsx");

describe("the logging card fits the screen", () => {
  it("every slide is exactly the row's width with the gutter inside it, snapping to centre every time; nothing sits between slides", () => {
    expect(carousel).toContain("snap-center snap-always shrink-0 w-full overflow-y-auto overscroll-contain px-5");
    expect(carousel).toContain("-mx-5 transition-[height]");
    expect(carousel).not.toContain("gap-4 transition-[height]");
    expect(carousel).not.toMatch(/px-5 gap-4/);
  });
  it("a slide is positioned so nothing inside it can widen the page", () => {
    expect(carousel).toContain('className="relative snap-center');
  });
  it("the card's height is measured from the top of the carousel down to the pinned bar, and a long card scrolls inside itself", () => {
    expect(carousel).toContain("window.innerHeight - top - BELOW_CARD_PX");
    expect(carousel).toContain("maxHeight: maxHeight ?? undefined");
  });
  it("a card left between two cards is put back on the nearest one when scrolling stops", () => {
    expect(carousel).toContain("Math.round(scroller.scrollLeft / width) * width");
  });
  it("the set grid columns are narrow enough for three or four sets inside the card", () => {
    expect(grid).not.toContain("w-16");
    expect(grid).toContain("w-12");
  });
  it("Add sits on the dots row when swiping sideways, and the page has no bottom padding to scroll through while a workout is in progress", () => {
    expect(logger).toContain('"absolute right-0 top-0 z-30"');
    expect(page).toContain('"pb-24" : "pb-32"');
  });
  it("the in-progress header is one slim row", () => {
    expect(page).toContain("In progress is ONE slim row");
  });
  it("More room sits on the Edit metrics row", () => {
    expect(card).toContain("{rowAction && <span");
    expect(carousel).toContain("rowAction={");
  });
});

describe("the check never writes a weight or an RPE", () => {
  it("tapping the check writes the set's status only", () => {
    const toggle = grid.slice(grid.indexOf("function toggleCheck("), grid.indexOf("function markTouched("));
    expect(toggle).toContain('save(set.id, { status: "completed", completed_at:');
    expect(toggle).not.toContain("weight");
    expect(toggle).not.toContain("rpe");
  });
});
