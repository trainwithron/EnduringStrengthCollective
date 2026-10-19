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
    expect(carousel).toContain("snap-center snap-always shrink-0 w-full overflow-x-hidden overflow-y-auto overscroll-x-auto overscroll-y-contain px-5");
    expect(carousel).toContain("-mx-5 transition-[height]");
    expect(carousel).not.toContain("gap-4 transition-[height]");
    expect(carousel).not.toMatch(/px-5 gap-4/);
  });
  it("a slide is positioned so nothing inside it can widen the page", () => {
    expect(carousel).toContain('className="relative snap-center');
  });
  it("the card's height is measured from the top of the carousel down to the pinned bar, and a long card scrolls inside itself", () => {
    expect(carousel).toContain("window.innerHeight - top - below");
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
    expect(page).toContain('"pb-16" : "pb-32"');
  });
  it("the in-progress header is one slim row", () => {
    expect(page).toContain("In progress is ONE slim row");
  });
  it("More room sits on the Edit metrics row", () => {
    expect(card).toContain("{rowAction && <span");
    expect(carousel).toContain("rowAction={");
  });
});

describe("there is no check on a set any more (Ron: \"I hate the checkboxes in the workout logger\")", () => {
  it("no Status row, no tap-to-complete", () => {
    expect(grid).not.toContain("function toggleCheck(");
    expect(grid).not.toContain("forcedIds");
    expect(grid).not.toContain(">Status<");
    expect(grid).not.toContain("Mark set complete");
  });
});

// V5 (Ron on his real Android phone: "I cannot swipe to the next exercise, only the top buttons work"). Found with real touch input (Edge in Android phone emulation, dragged with CDP touch events), not by
// measuring CSS. Three real causes, each proven by switching it on and off: (1) overscroll-behavior: contain on each slide kept a horizontal drag from reaching the carousel, (2) the "settle to centre" timer
// pulled the card back under a finger that paused, (3) a set cell took over the touch. And a long "Next:" name widened the whole page, so the phone zoomed out and nothing fit.
describe("the swipe works with a real finger", () => {
  it("a slide never blocks a horizontal drag from reaching the carousel", () => {
    expect(carousel).not.toContain("overscroll-contain");
    expect(carousel).toContain("overscroll-x-auto overscroll-y-contain");
  });
  it("the settle step waits for the scroll to end and for the finger to lift", () => {
    expect(carousel).toContain('scroller.addEventListener("scrollend", settle)');
    expect(carousel).toContain("if (touching) return;");
    expect(carousel).not.toContain("setTimeout(() => {\n        const width");
  });
  it("a set cell does not take a touch drag away from the swipe", () => {
    expect(grid).not.toContain("touch-pan-y");
    expect(grid).toContain('e.pointerType === "touch"');
  });
  it("a long next-exercise name is cut short and the page can never grow wider than the screen", () => {
    const strip = read("components/logging/session-progress-strip.tsx");
    expect(strip).toContain('<span className="text-chalk truncate">{next.exerciseName}</span>');
    expect(page).toContain("overflow-x-clip");
  });
});

describe("the chrome is slim so the card gets the height", () => {
  it("one 32px Coach mode line: Coach mode on the left, Logging for [Name] on the right, no Home button, a smaller sparkle, Home inside the hub", () => {
    const bar = read("components/coach/mobile/coach-mode-bar.tsx");
    expect(bar).toContain("h-8");
    expect(bar).toContain("Coach mode");
    expect(bar).toContain("Logging for {clientName}");
    expect(bar).not.toContain("<Link");
    expect(bar).toContain("homeHref={homeHref} compact");
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain("href={homeHref}");
  });
  it("the Complete bar is one compact row whose real height the card budget uses", () => {
    const button = read("components/session/complete-workout-button.tsx");
    expect(button).toContain("data-complete-bar");
    expect(button).toContain('className="w-full h-12 bg-rust');
    expect(carousel).toContain('document.querySelector("[data-complete-bar]")');
  });
  it("the timer, the dots, the note and the sets stepper are tightened", () => {
    expect(read("components/session/session-stopwatch.tsx")).toContain("text-2xl");
    expect(read("components/logging/set-stepper.tsx")).toContain("h-10 w-10");
    expect(read("components/logging/exercise-athlete-note.tsx")).toContain("min-h-[40px]");
  });
});

describe("Send to client sits on the header row while logging", () => {
  it("one small button on the Back and title row for a coach logging a client's workout, not a row of its own", () => {
    expect(page).toContain("workoutTitle={(session as any).workouts?.title ?? \"Workout\"} compact />");
    expect(read("components/session/send-to-client-button.tsx")).toContain("📲 Send to client");
    expect(page).not.toContain("📲 Send to client to finish");
  });
});
