import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { BuilderDay, BuilderExercise, BuilderNote } from "@/lib/types";
import type { DemoRow } from "@/lib/exercise-demo";
import type { TrackedField } from "@/lib/exercise-fields";

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }),
}));

import { ClientPreviewSheet, ClientPreviewButton } from "./client-preview";

const set = (id: string, o: Partial<Record<string, unknown>> = {}) => ({
  id,
  setOrder: 0,
  targetReps: null,
  targetWeight: null,
  targetRpe: null,
  targetRir: null,
  targetTempo: null,
  targetTimeSeconds: null,
  targetHeight: null,
  targetDistance: null,
  targetRestSeconds: null,
  targetPace: null,
  repMin: null,
  repMax: null,
  ...o,
});
const exercise = (id: string, order: number, name: string, tracked: TrackedField[], sets: ReturnType<typeof set>[], notes: string | null = null): BuilderExercise => ({
  kind: "exercise",
  id,
  order,
  exerciseName: name,
  displayName: null,
  movementPatternId: null,
  trackedFields: tracked,
  notes,
  videoPath: null,
  youtubeUrl: null,
  tier: null,
  sets: sets as BuilderExercise["sets"],
});
const note = (id: string, order: number, body: string): BuilderNote => ({ kind: "note", id, order, body });

const LIBRARY: DemoRow[] = [{ name: "Bulgarian Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/splitsplit1" }];

const DAY1: BuilderDay = {
  id: "d1",
  title: "Day 1 - Legs",
  weekNumber: 1,
  dayIndex: 0,
  scheduledDate: null,
  items: [
    exercise("e2", 2, "Plank", ["time"], [set("s4", { targetTimeSeconds: 60 }), set("s5", { targetTimeSeconds: 60 })], "Brace hard"),
    note("n1", 0, "Warm up for 10 minutes first"),
    exercise("e1", 1, "Bulgarian Split Squat", ["reps", "weight", "rest"], [1, 2, 3].map((i) => set(`s${i}`, { targetReps: "10", targetWeight: 50, targetRestSeconds: 90 }))),
    note("n2", 3, "   "),
  ],
};
const DAY2: BuilderDay = { id: "d2", title: "Day 2 - Upper", weekNumber: 1, dayIndex: 1, scheduledDate: null, items: [] };

const render = (days: BuilderDay[], heading = "Day 1 - Legs") => renderToStaticMarkup(createElement(ClientPreviewSheet, { days, heading, demoLibrary: LIBRARY, onClose: () => {} }));

describe("Preview as my client sees it", () => {
  it("lists the exercises in order with what is prescribed: sets, reps, load and rest", () => {
    const html = render([DAY1]);
    expect(html.indexOf("Bulgarian Split Squat")).toBeLessThan(html.indexOf("Plank"));
    expect(html).toContain("3x10 @ 50 lb · rest 90s");
    expect(html).toContain("2x60s");
  });
  it("shows the coach's exercise notes and the day's note, and skips an empty note", () => {
    const html = render([DAY1]);
    expect(html).toContain("Brace hard");
    expect(html).toContain("Warm up for 10 minutes first");
    expect(html.match(/whitespace-pre-wrap/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("shows the demo picture that opens the same demo, only where the exercise has one", () => {
    const html = render([DAY1]);
    expect(html).toContain("Watch the Bulgarian Split Squat demo");
    expect(html).toContain("/api/demo-thumb/splitsplit1");
    expect(html).not.toContain("Watch the Plank demo");
  });
  it("is read only and says so, with a 44 px Close button and dialog roles", () => {
    const html = render([DAY1]);
    expect(html).toContain("Read only. Nothing here is saved or sent.");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("h-11");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });
  it("a week shows every day under its title, and an empty day says so", () => {
    const html = render([DAY1, DAY2], "Week 1");
    expect(html).toContain("Day 1 - Legs");
    expect(html).toContain("Day 2 - Upper");
    expect(html).toContain("No exercises on this day yet.");
  });
  it("a single day does not repeat its title as a section heading", () => {
    const html = render([DAY1]);
    expect(html).not.toContain("<h3");
  });
  it("the button opens nothing until it is pressed", () => {
    const html = renderToStaticMarkup(createElement(ClientPreviewButton, { days: [DAY1], heading: "Day 1 - Legs", label: "Preview", demoLibrary: LIBRARY }));
    expect(html).toContain("Preview");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("where the preview buttons are", () => {
  const day = readFileSync(new URL("./day-card.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const week = readFileSync(new URL("./week-grid.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("each day has a Preview button and each week a Preview week button", () => {
    expect(day).toContain('<ClientPreviewButton days={[day]}');
    expect(day).toContain('label="Preview"');
    expect(week).toContain('label="Preview week"');
    expect(week).toContain("days={sortedDays}");
  });
  it("the sheet sits under the demo sheet so a demo opened from it shows on top", () => {
    const sheet = readFileSync(new URL("./client-preview.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("z-40");
    expect(readFileSync(new URL("../../logging/demo-sheet.tsx", import.meta.url), "utf8")).toContain("z-50");
  });
});
