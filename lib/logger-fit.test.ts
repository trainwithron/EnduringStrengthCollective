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
  it("the room under the card is everything from the top of the Complete bar down (the bar AND the tab bar under it), not the bar's own height", () => {
    expect(horizontal).toContain("const below = (bar ? window.innerHeight - bar.getBoundingClientRect().top : 65) + 4;");
    expect(horizontal).not.toContain("offsetHeight ?? 65");
    expect(horizontal).toContain("Math.floor(window.innerHeight - top - below)");
  });
  it("the top is one slim block while a workout is in progress", () => {
    expect(page).toContain('"relative px-4 pt-2 pb-2"');
    expect(page).toContain("font-display font-semibold text-lg leading-tight truncate");
  });
  // Look Refresh (client step, Nov 20): a rest starts any time from the bottom bar's Rest button; the prompt after a set and the countdown are sheets up from the bottom.
  it("a rest can start any time (the bottom bar); the prompt and countdown open as sheets from the bottom; the stopwatch is on the header's top line", () => {
    expect(rest).toContain("{showPrompt && (");
    expect(rest).toContain("if (!showPrompt && !running && !justFinished) return null;");
    expect(rest).toContain("onClick={() => startPreset(seconds)} className={chip(");
    expect(rest).toContain("fixed inset-x-0 bottom-0 z-50");
    expect(read("components/logging/session-logger.tsx")).toContain("onClick={startBarRest}");
    expect(rest).not.toContain("<SessionStopwatch");
    expect(rest).not.toContain("startedAt: string;");
    expect(page).toContain("<SessionStopwatch startedAt={session.started_at} compact />");
    // the coach logging for a client: stopwatch and Send to client on the same top line
    const top = page.slice(page.indexOf('<div className="flex items-center gap-2.5">'), page.indexOf(") : (\n          <Link href={backHref}"));
    expect(top).toContain("<SessionStopwatch");
    expect(top).toContain("<FinishWorkoutButton />");
    expect(top).toContain("<SendToClientButton");
    expect(page).not.toContain('<span className="w-12 shrink-0" aria-hidden="true" />');
    expect(page).toContain("In progress is ONE slim row");
  });
  it("while the workout is live the bottom tabs are hidden and the Complete bar sits at the bottom", () => {
    expect(page).toContain('{isOwnSession && session.status !== "in_progress" && <BottomTabBar');
    expect(page).toContain('raised={isOwnSession && session.status !== "in_progress"}');
  });
  it("the notes box is one line that opens when used, and one small '+ Add exercise' button opens the library search (Quick add inside it)", () => {
    expect(note).toContain("rows={1}");
    expect(note).toContain("focus:min-h-[96px]");
    expect(logger).toContain("+ Add exercise");
    expect(logger).toContain("onClick={() => setAddingExercise(true)}");
  });
  it("the next-exercise strip steps aside on a short screen", () => {
    expect(strip).toContain("[@media(max-height:760px)]:hidden");
  });
});
