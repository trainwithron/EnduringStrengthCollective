import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: the swipe-card logger must fit the screen with no page scroll, and snap one exercise at a time in both directions (never halfway). Source-level guards (the layout itself is checked by eye at
// 360x640 and 412x915).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const horizontal = read("components/logging/exercise-swipe-carousel.tsx");
const vertical = read("components/logging/exercise-vertical-carousel.tsx");
const logger = read("components/logging/session-logger.tsx");
const rest = read("components/session/rest-timer-bar.tsx");
const note = read("components/logging/exercise-athlete-note.tsx");
const page = read("app/sessions/[sessionId]/page.tsx");
const strip = read("components/logging/session-progress-strip.tsx");

describe("one exercise per snap, both directions", () => {
  it("every card is a mandatory snap point that a fling cannot skip", () => {
    expect(horizontal).toContain("snap-x snap-mandatory");
    expect(horizontal).toContain("snap-center snap-always");
    expect(vertical).toContain("snap-y snap-mandatory");
    expect(vertical).toContain("snap-center snap-always");
  });
});

describe("the card fits the screen", () => {
  it("the carousel is capped to the viewport and a long card scrolls inside itself", () => {
    expect(horizontal).toContain("maxHeight: maxHeight ?? undefined");
    expect(horizontal).toContain("overflow-x-hidden overflow-y-auto overscroll-x-auto overscroll-y-contain px-5");
    expect(vertical).toContain("max-h-[calc(100dvh-14rem)]");
  });
  it("the top is one slim block while a workout is in progress", () => {
    expect(page).toContain('"relative px-5 pt-1 pb-1 border-b border-steel/20"');
    expect(page).toContain("font-display font-bold text-lg leading-none uppercase truncate");
  });
  it("the rest timer is one line: the Rest? chips sit on the stopwatch row", () => {
    const top = rest.slice(rest.indexOf("<SessionStopwatch"), rest.indexOf("{running && ("));
    expect(top).toContain("{showPrompt && (");
    expect(rest).toContain("px-5 py-1");
  });
  it("the notes box is one line that opens when used, and Add / Quick add sit behind one small button", () => {
    expect(note).toContain("rows={1}");
    expect(note).toContain("focus:min-h-[96px]");
    expect(logger).toContain("+ Add");
    expect(logger).toContain("addMenuOpen");
  });
  it("the next-exercise strip steps aside on a short screen", () => {
    expect(strip).toContain("[@media(max-height:760px)]:hidden");
  });
});
