import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { builderDemoFor } from "@/lib/builder-demo";
import type { DemoRow } from "@/lib/exercise-demo";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }),
}));

import { BuilderDemoThumb } from "./builder-demo-thumb";
import { ExerciseNameInput } from "./exercise-name-input";

const LIBRARY: DemoRow[] = [
  { name: "Barbell Row", videoPath: null, youtubeUrl: "https://youtu.be/rowrowrow11" },
  { name: "Barbell Overhead Press", videoPath: null, youtubeUrl: "https://youtu.be/presspress1" },
  { name: "Rear Foot Elevated Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/splitsplit1" },
  { name: "Plank", videoPath: "coach/plank.mp4", youtubeUrl: null },
  { name: "Cable Fly", videoPath: null, youtubeUrl: null },
];

describe("the demo for an exercise comes from its CURRENT name in the coach's library", () => {
  it("finds the video stored under that name", () => {
    const b = builderDemoFor(LIBRARY, "Barbell Row");
    expect(b?.demo.youtubeUrl).toBe("https://youtu.be/rowrowrow11");
    expect(b?.storedUnder).toBeNull();
  });
  it("changing the exercise changes the video: it is looked up again, not remembered from before", () => {
    expect(builderDemoFor(LIBRARY, "Barbell Row")?.demo.youtubeUrl).toBe("https://youtu.be/rowrowrow11");
    expect(builderDemoFor(LIBRARY, "Barbell Overhead Press")?.demo.youtubeUrl).toBe("https://youtu.be/presspress1");
  });
  it("a movement known by two names finds the video and says which name it is stored under, so a mismatch is visible", () => {
    const b = builderDemoFor(LIBRARY, "Bulgarian Split Squat");
    expect(b?.demo.youtubeUrl).toBe("https://youtu.be/splitsplit1");
    expect(b?.storedUnder).toBe("Rear Foot Elevated Split Squat");
  });
  it("an exercise with no video, or one that is not in the library, has none", () => {
    expect(builderDemoFor(LIBRARY, "Cable Fly")).toBeNull();
    expect(builderDemoFor(LIBRARY, "Zercher Squat")).toBeNull();
    expect(builderDemoFor([], "Barbell Row")).toBeNull();
  });
  it("is another coach's library only if it is passed in: a different library gives a different answer", () => {
    const other: DemoRow[] = [{ name: "Barbell Row", videoPath: null, youtubeUrl: "https://youtu.be/otherother1" }];
    expect(builderDemoFor(other, "Barbell Row")?.demo.youtubeUrl).toBe("https://youtu.be/otherother1");
  });
});

describe("the thumbnail", () => {
  it("is a lazy-loaded picture of the YouTube demo that opens the demo, with the exercise named for screen readers", () => {
    const html = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Barbell Row", demo: builderDemoFor(LIBRARY, "Barbell Row") }));
    expect(html).toContain('src="/api/demo-thumb/rowrowrow11"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Watch the Barbell Row demo");
    expect(html).toContain("min-h-11");
    // nothing plays or opens until it is tapped
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<video");
  });
  it("names the exercise the video belongs to under the picture when it is stored under another name", () => {
    const html = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Bulgarian Split Squat", demo: builderDemoFor(LIBRARY, "Bulgarian Split Squat") }));
    expect(html).toContain("Demo: Rear Foot Elevated Split Squat");
    expect(html).toContain("text-rust");
  });
  it("shows just 'Demo' under the picture when it is the exercise's own video, and no caption in the collapsed card", () => {
    const own = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Barbell Row", demo: builderDemoFor(LIBRARY, "Barbell Row") }));
    expect(own).toContain(">Demo<");
    const collapsed = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Barbell Row", demo: builderDemoFor(LIBRARY, "Barbell Row"), showCaption: false }));
    expect(collapsed).not.toContain(">Demo<");
  });
  it("an uploaded video with no picture shows a plain play tile (no image)", () => {
    const html = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Plank", demo: builderDemoFor(LIBRARY, "Plank") }));
    expect(html).not.toContain("<img");
    expect(html).toContain("Watch the Plank demo");
  });
  it("an exercise with no video shows a quiet 'No video yet' tile, and offers to add one when it can", () => {
    const plain = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Cable Fly", demo: null }));
    expect(plain).toContain("No video yet");
    expect(plain).not.toContain("<button");
    const withAdd = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Cable Fly", demo: null, onAddVideo: () => {} }));
    expect(withAdd).toContain("<button");
    expect(withAdd).toContain("No video yet for Cable Fly. Add one");
  });
  it("the tiny size, for the dropdown rows, is a picture only and not a button", () => {
    const html = renderToStaticMarkup(createElement(BuilderDemoThumb, { exerciseName: "Barbell Row", demo: builderDemoFor(LIBRARY, "Barbell Row"), size: "tiny" }));
    expect(html).toContain('src="/api/demo-thumb/rowrowrow11"');
    expect(html).toContain("w-10 h-6");
    expect(html).not.toContain("<button");
  });
  it("opens the SAME demo sheet the client sees, with the coach's notes in its Exercise details", () => {
    const src = readFileSync(new URL("./builder-demo-thumb.tsx", import.meta.url), "utf8");
    expect(src).toContain('from "@/components/logging/demo-sheet"');
    expect(src).toContain("details={notes ? { notes, equipment: null } : null}");
    expect(src).toContain("videoPath={demo.demo.videoPath}");
  });
});

describe("the name box and the card", () => {
  const LONG = "Split Stance Cable Row With A Long Pause At The Chest, Neutral Grip, Tempo 3-1-1";
  it("keeps the full name as a tooltip, and fills its row (a 60+ character name)", () => {
    expect(LONG.length).toBeGreaterThan(60);
    const html = renderToStaticMarkup(createElement(ExerciseNameInput, { value: LONG, onChange: () => {}, suggestions: [] }));
    expect(html).toContain(`title="${LONG}"`);
    expect(html).toContain("w-full");
  });
  it("shows a tiny picture on each dropdown row when the library is passed", () => {
    const src = readFileSync(new URL("./exercise-name-input.tsx", import.meta.url), "utf8");
    expect(src).toContain('<BuilderDemoThumb size="tiny"');
    expect(src).toContain("builderDemoFor(demoLibrary, row.name)");
  });
  const card = readFileSync(new URL("./exercise-builder-card.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("the card puts the name on its own full-width row with the picture beside it, open or collapsed, and the controls on a slim row above", () => {
    expect(card).toContain("<BuilderDemoThumb");
    expect(card).toContain("showCaption={!collapsed}");
    expect(card.indexOf('aria-label="Delete exercise"')).toBeLessThan(card.indexOf("<ExerciseNameInput"));
    expect(card).toContain("w-11 h-11 sm:w-7 sm:h-7");
  });
  it("the demo is looked up from the exercise's current name, not the snapshot taken when the page loaded", () => {
    expect(card).toContain("builderDemoFor(demoLibrary, exercise.exerciseName)");
    expect(card).toContain("mediaOverride.name === exercise.exerciseName");
  });
  it("the old separate Demo button is gone (the picture opens the same sheet)", () => {
    expect(card).not.toContain("<ExerciseDemoButton");
  });
});

describe("the lookup is kept per library and name (speed)", () => {
  it("the same inputs give the same answer, and the same object, without scanning the library again", () => {
    const lib: DemoRow[] = [{ name: "Barbell Row", videoPath: null, youtubeUrl: "https://youtu.be/rowrowrow11" }];
    const first = builderDemoFor(lib, "Barbell Row");
    expect(builderDemoFor(lib, "  barbell row ")).toBe(first);
    expect(builderDemoFor(lib, "Zercher Squat")).toBeNull();
    expect(builderDemoFor(lib, "Zercher Squat")).toBeNull();
  });
  it("a different library (a reload) does not reuse the old answers", () => {
    const a: DemoRow[] = [{ name: "Barbell Row", videoPath: null, youtubeUrl: "https://youtu.be/rowrowrow11" }];
    const b: DemoRow[] = [{ name: "Barbell Row", videoPath: null, youtubeUrl: "https://youtu.be/newnewnew11" }];
    expect(builderDemoFor(a, "Barbell Row")?.demo.youtubeUrl).toBe("https://youtu.be/rowrowrow11");
    expect(builderDemoFor(b, "Barbell Row")?.demo.youtubeUrl).toBe("https://youtu.be/newnewnew11");
  });
});
