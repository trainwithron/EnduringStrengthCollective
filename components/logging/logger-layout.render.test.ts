import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { ExerciseAthleteNote } from "./exercise-athlete-note";
import { DemoThumb } from "./demo-thumb";

// Johann's beta feedback (Day 3, Dumbbell Shrug): a large empty dark area inside a short exercise card, a small demo video, and a note that was only a small
// "+ Add a note" link.
describe("the note on an exercise card", () => {
  it("is a visible, labelled field while logging, not a small link, and its text is 16 px so a phone does not zoom in", () => {
    const html = renderToStaticMarkup(createElement(ExerciseAthleteNote, { sessionExerciseId: "e1", initialNote: null, readOnly: false }));
    expect(html).toContain("<textarea");
    expect(html).toContain("Your notes");
    expect(html).toContain("How did it feel?");
    expect(html).toContain("text-base");
    expect(html).not.toContain("+ Add a note");
  });
  it("keeps a saved note in the field", () => {
    const html = renderToStaticMarkup(createElement(ExerciseAthleteNote, { sessionExerciseId: "e1", initialNote: "Left shoulder felt tight", readOnly: false }));
    expect(html).toContain("Left shoulder felt tight");
  });
  it("is a plain line in a finished workout, and nothing when there is no note", () => {
    expect(renderToStaticMarkup(createElement(ExerciseAthleteNote, { sessionExerciseId: "e1", initialNote: "Felt heavy", readOnly: true }))).toContain("Note: Felt heavy");
    expect(renderToStaticMarkup(createElement(ExerciseAthleteNote, { sessionExerciseId: "e1", initialNote: null, readOnly: true }))).toBe("");
  });
});

describe("the demo video on an exercise card", () => {
  it("is bigger than before (a client asked), still one tap target with the play mark", () => {
    const html = renderToStaticMarkup(createElement(DemoThumb, { title: "Dumbbell Shrug", youtubeUrl: "https://youtu.be/abcdefghijk", onOpen: () => {} }));
    expect(html).toContain("w-40");
    expect(html).not.toContain("w-28");
    expect(html).toContain("Watch the Dumbbell Shrug demo");
  });
});

describe("the exercise cards size to their content", () => {
  const swipe = readFileSync(new URL("./exercise-swipe-carousel.tsx", import.meta.url), "utf8");
  const vertical = readFileSync(new URL("./exercise-vertical-carousel.tsx", import.meta.url), "utf8");
  it("the swipe carousel no longer stretches every card to the tallest one: cards align to the top and the row is as tall as the ACTIVE card", () => {
    expect(swipe).toContain("flex items-start overflow-x-auto overflow-y-hidden");
    expect(swipe).toContain("height: activeHeight");
    expect(swipe).toContain("ResizeObserver");
  });
  it("the vertical carousel no longer reserves a fixed 65 percent of the screen: it is as tall as its content, up to that, then scrolls", () => {
    expect(vertical).toContain("max-h-[65vh]");
    expect(vertical).not.toMatch(/(?<!max-)h-\[65vh\]/);
  });
});

describe("the review fixes for the layout (Assistant, Oct 7)", () => {
  const swipe = readFileSync(new URL("./exercise-swipe-carousel.tsx", import.meta.url), "utf8");
  const vertical = readFileSync(new URL("./exercise-vertical-carousel.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("./exercise-card.tsx", import.meta.url), "utf8");
  const thumb = readFileSync(new URL("./demo-thumb.tsx", import.meta.url), "utf8");
  const note = readFileSync(new URL("./exercise-athlete-note.tsx", import.meta.url), "utf8");
  it("the swipe row always shows the top of the active card (a field focused in a neighbour cannot leave it scrolled), rounds the height UP, follows the right element and eases the change", () => {
    expect(swipe).toContain("scroller.scrollTop = 0");
    expect(swipe).toContain("Math.ceil(slide.getBoundingClientRect().height)");
    expect(swipe).toContain("activeExerciseId");
    expect(swipe).toContain("transition-[height]");
    expect(swipe).toContain("motion-reduce:transition-none");
  });
  it("on a small phone the demo stacks above Last time (side by side from 380 px), so Last time and the volume chart keep their width", () => {
    expect(card).toContain("flex flex-col min-[380px]:flex-row");
    expect(thumb).toContain("w-full max-w-[208px] min-[380px]:w-40");
  });
  it("the vertical list marks the exercise the athlete touches or types in as the active one (when everything fits nothing scrolls)", () => {
    expect(vertical).toContain("onFocusCapture");
    expect(vertical).toContain("onPointerDownCapture");
  });
  it("More room is a 44 px target in both carousels", () => {
    expect(swipe).toContain("min-h-[44px]");
    expect(vertical).toContain("min-h-[44px]");
  });
  it("the note saves as you type, on leaving, when hidden, registers with Complete workout, and has a Retry", () => {
    expect(note).toContain("registerPending");
    expect(note).toContain("visibilitychange");
    expect(note).toContain("pagehide");
    expect(note).toContain("Retry");
    expect(note).toContain("e.currentTarget.value");
  });
  it("a coach typing in a client's session sees whose note it is", () => {
    const html = renderToStaticMarkup(createElement(ExerciseAthleteNote, { sessionExerciseId: "e2", initialNote: null, readOnly: false, ownNote: false }));
    expect(html).toContain("Notes for this exercise");
  });
});
