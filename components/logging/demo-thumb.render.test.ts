import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }),
}));

import { DemoThumb } from "./demo-thumb";
import { DemoSheet } from "./demo-sheet";
import { DemoBrowserSheet } from "./demo-browser-sheet";

describe("the demo thumbnail on the exercise card", () => {
  it("is a small tap target with a play mark whose picture comes from our own route, never straight from YouTube", () => {
    const html = renderToStaticMarkup(createElement(DemoThumb, { title: "Back Squat", youtubeUrl: "https://youtu.be/abcdefghijk", onOpen: () => {} }));
    expect(html).toContain('src="/api/demo-thumb/abcdefghijk"');
    expect(html).not.toContain("ytimg.com");
    expect(html).toContain("Watch the Back Squat demo");
    expect(html).toContain("<svg");
  });
  it("is a plain tile with the play mark (no picture request) for an upload or a video with no link", () => {
    const html = renderToStaticMarkup(createElement(DemoThumb, { title: "Band Pull-Apart", youtubeUrl: null, onOpen: () => {} }));
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
  });
});

describe("the demo sheet", () => {
  const base = { title: "Back Squat", youtubeUrl: "https://youtu.be/abcdefghijk", onClose: () => {} };
  it("embeds the no-cookie player without autoplay and offers Open in YouTube", () => {
    const html = renderToStaticMarkup(createElement(DemoSheet, base));
    expect(html).toContain("youtube-nocookie.com/embed/abcdefghijk");
    expect(html).not.toContain("autoplay");
    expect(html).toContain("Open in YouTube");
  });
  it("has a collapsed Exercise details only when there is something in it", () => {
    expect(renderToStaticMarkup(createElement(DemoSheet, { ...base, details: { notes: null, equipment: null } }))).not.toContain("Exercise details");
    const html = renderToStaticMarkup(createElement(DemoSheet, { ...base, details: { notes: "Brace and sit between your hips", equipment: "barbell" } }));
    expect(html).toContain("Exercise details");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Brace and sit");
  });
  it("shows Previous, Next and 'N of M exercises' when it is stepping through a workout", () => {
    const html = renderToStaticMarkup(
      createElement(DemoSheet, { ...base, nav: { index: 0, total: 9, prev: null, next: { name: "Incline Bench Press", youtubeUrl: "https://youtu.be/bbbbbbbbbbb" }, onPrev: () => {}, onNext: () => {} } })
    );
    expect(html).toContain("1 of 9 exercises");
    expect(html).toContain("Incline Bench Press");
    expect(html).toContain("Previous");
    expect(html).toContain('src="/api/demo-thumb/bbbbbbbbbbb"');
  });
});

describe("stepping through the workout", () => {
  const ex = (id: string, name: string, notes: string | null = null) => ({ id, exerciseName: name, exerciseOrder: 0, isSwapped: false, isAdded: false, trackedFields: [], videoUrl: null, youtubeUrl: null, notes, sets: [] }) as never;
  it("shows the chosen exercise with its position, its coach notes behind Exercise details, and the neighbours' names", () => {
    const html = renderToStaticMarkup(
      createElement(DemoBrowserSheet, {
        exercises: [ex("a", "Back Squat"), ex("b", "Bulgarian Split Squat", "Slow down"), ex("c", "Calf Raise")],
        library: [{ name: "Rear Foot Elevated Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/abcdefghijk" }],
        currentId: "b",
        onChange: () => {},
        onClose: () => {},
      })
    );
    expect(html).toContain("2 of 3 exercises");
    expect(html).toContain("Back Squat");
    expect(html).toContain("Calf Raise");
    expect(html).toContain("youtube-nocookie.com/embed/abcdefghijk");
    expect(html).toContain("Demo: Rear Foot Elevated Split Squat");
    expect(html).toContain("Exercise details");
  });
});

describe("privacy and the logger wiring", () => {
  it("the only place that asks YouTube's image host for a picture is our own route", () => {
    expect(readFileSync(new URL("../../lib/exercise-demo.ts", import.meta.url), "utf8")).toContain("i.ytimg.com");
    for (const f of ["./demo-thumb.tsx", "./demo-sheet.tsx", "./exercise-card.tsx", "./demo-browser-sheet.tsx"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toContain("ytimg");
    }
  });
  it("the card puts the thumbnail beside Last time, and both carousels mark each slide so the workout returns to where the sheet ended", () => {
    const card = readFileSync(new URL("./exercise-card.tsx", import.meta.url), "utf8");
    expect(card).toContain("<DemoThumb");
    expect(card.indexOf("<DemoThumb")).toBeLessThan(card.indexOf("Last time:"));
    for (const f of ["./exercise-swipe-carousel.tsx", "./exercise-vertical-carousel.tsx"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8")).toContain("data-exercise-id={exercise.id}");
    }
    expect(readFileSync(new URL("./session-logger.tsx", import.meta.url), "utf8")).toContain("<DemoBrowserSheet");
  });
});
