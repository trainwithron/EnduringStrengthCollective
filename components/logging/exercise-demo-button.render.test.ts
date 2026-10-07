import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }),
}));

import { ExerciseDemoButton } from "./exercise-demo-button";

describe("the Demo button", () => {
  it("is a clear labelled button with a play mark and a tap-sized height when there is a demo", () => {
    const html = renderToStaticMarkup(createElement(ExerciseDemoButton, { title: "Back Squat", youtubeUrl: "https://youtu.be/abcdefghijk" }));
    expect(html).toContain(">Demo<");
    expect(html).toContain("Watch the Back Squat demo");
    expect(html).toContain("h-11");
  });

  it("shows nothing at all when the exercise has no demo", () => {
    expect(renderToStaticMarkup(createElement(ExerciseDemoButton, { title: "Back Squat", youtubeUrl: null }))).toBe("");
  });

  it("does not open or play anything until it is tapped", () => {
    const html = renderToStaticMarkup(createElement(ExerciseDemoButton, { title: "Back Squat", youtubeUrl: "https://youtu.be/abcdefghijk" }));
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<video");
  });
});

describe("the logger shows the demo through the button, from the library, and honours the client's choice", () => {
  const card = readFileSync(new URL("./exercise-card.tsx", import.meta.url), "utf8");
  it("the exercise card uses the lookup by what the exercise is, the button, and the hide setting; the tiny link and 200px video are gone", () => {
    expect(card).toContain("findDemo(demoLibrary, exercise.exerciseName)");
    expect(card).toContain("<ExerciseDemoButton");
    expect(card).toContain("!demosHidden");
    expect(card).not.toContain("Watch demo");
    expect(card).not.toContain("max-w-[200px]");
  });
  it("an exercise added or swapped mid-workout is looked up from its current name, because the card resolves by name from the library", () => {
    const logger = readFileSync(new URL("./session-logger.tsx", import.meta.url), "utf8");
    expect(logger).toContain("<DemoLibraryProvider value={demoLibrary ? demoBrowser : null}>");
  });
  it("the session page gives the logger the library, and Settings has the hide control for clients", () => {
    expect(readFileSync(new URL("../../app/sessions/[sessionId]/page.tsx", import.meta.url), "utf8")).toContain("demoLibrary={demoLibrary}");
    expect(readFileSync(new URL("../../app/(coach)/groups/[groupId]/settings/page.tsx", import.meta.url), "utf8")).toContain("<HideDemosToggle />");
  });
});
