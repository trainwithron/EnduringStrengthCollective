import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findDemo, platformOnly, withPlatformDemos, type DemoRow } from "./exercise-demo";
import { builderDemoFor } from "./builder-demo";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }) }));

// Ron, Oct 26: "i am building the sofware wide video library out as a starting point and coaches can add there own later". The database side (who may read what) is rehearsed in
// scripts/sql-tests/rehearsal/0434.test.mjs: every signed-in person reads the demo fields and exactly the demo videos, signed-out visitors nothing, nobody uploads into the admin's folder,
// and the admin's rows without a demo never show.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const platform: DemoRow[] = [
  { name: "Goblet Squat", videoPath: "ron/goblet.mp4", youtubeUrl: null },
  { name: "Bulgarian Split Squats", videoPath: null, youtubeUrl: "https://youtu.be/aaaaaaaaaaa" },
  { name: "Rear Foot Elevated Split Squat", videoPath: null, youtubeUrl: "https://youtu.be/bbbbbbbbbbb" },
  { name: "RDL", videoPath: null, youtubeUrl: "https://youtu.be/ccccccccccc" },
];

describe("the coach's own demo first, then the Spotlight demo, then nothing", () => {
  it("a coach's own demo beats the platform one", () => {
    const rows = withPlatformDemos([{ name: "Goblet Squat", videoPath: null, youtubeUrl: "https://youtu.be/ownownownow" }], platform);
    expect(findDemo(rows, "Goblet Squat")).toEqual({ videoPath: null, youtubeUrl: "https://youtu.be/ownownownow", foundAs: "Goblet Squat" });
  });
  it("even the coach's own spelling variant beats the platform's exact name (own tier first, with every rule)", () => {
    const rows = withPlatformDemos([{ name: "Goblet Squats", videoPath: null, youtubeUrl: "https://youtu.be/ownownownow" }], platform);
    expect(findDemo(rows, "Goblet Squat")?.platform).toBeUndefined();
  });
  it("with no demo of their own: the platform demo, by exact name, spelling variant and second name for the movement", () => {
    const rows = withPlatformDemos([{ name: "Goblet Squat", videoPath: null, youtubeUrl: null }], platform);
    expect(findDemo(rows, "Goblet Squat")).toEqual({ videoPath: "ron/goblet.mp4", youtubeUrl: null, foundAs: "Goblet Squat", platform: true });
    expect(findDemo(rows, "Bulgarian Split Squat")?.foundAs).toBe("Bulgarian Split Squats");
    expect(findDemo(rows, "Romanian Deadlift")).toMatchObject({ foundAs: "RDL", platform: true });
    expect(findDemo(rows, "Kettlebell Swing")).toBeNull();
  });
  it("no platform demos (before the database step, or a failed read): exactly as before", () => {
    const own: DemoRow[] = [{ name: "Push Up", videoPath: null, youtubeUrl: "https://youtu.be/ddddddddddd" }];
    expect(withPlatformDemos(own, [])).toBe(own);
    expect(findDemo(withPlatformDemos(own, []), "Goblet Squat")).toBeNull();
  });
  it("a coach who removes their own gets the platform one back (the builder falls back to the Spotlight demos)", () => {
    const rows = withPlatformDemos([{ name: "Goblet Squat", videoPath: null, youtubeUrl: "https://youtu.be/ownownownow" }], platform);
    expect(platformOnly(rows).every((r) => r.platform)).toBe(true);
    expect(platformOnly(rows)).toBe(platformOnly(rows));
    expect(builderDemoFor(platformOnly(rows), "Goblet Squat")?.demo.platform).toBe(true);
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("? builderDemoFor(platformOnly(demoLibrary), exercise.exerciseName)");
  });
});

describe("every screen that shows demos reads the Spotlight ones once per page", () => {
  it("the logger, the workout overview, the builder and the phone program view", () => {
    expect(read("app/sessions/[sessionId]/page.tsx")).toContain("for (const r of await loadPlatformDemos(supabase)) demoLibrary.push(r);");
    expect(read("components/shared/program-plain-view-server.tsx")).toContain("for (const r of await loadPlatformDemos(supabase)) demoLibrary.push(r);");
    expect(read("lib/workout-overview-data.ts")).toContain("await loadPlatformDemos(supabase));");
    expect(read("lib/program-builder-data.ts")).toContain("await loadPlatformDemos(supabase));");
    const loader = read("lib/platform-demos.ts");
    expect(loader).toContain("export const loadPlatformDemos = cache(readPlatformDemos);");
    expect(loader).toContain('supabase.rpc("platform_demo_rows")');
    expect(loader).toContain("if (error || !Array.isArray(data)) return [];");
  });
});

describe("the picker says when the Spotlight demo is showing, and never treats it as the coach's own", () => {
  it("one line, only for the Spotlight demo", async () => {
    const { ExerciseMediaPicker } = await import("@/components/coach/exercise-media-picker");
    const shown = renderToStaticMarkup(createElement(ExerciseMediaPicker, { exerciseName: "Goblet Squat", videoPath: null, youtubeUrl: null, platformDemo: true, onChange: () => {} }));
    expect(shown).toContain("Spotlight demo. Add your own to replace it.");
    const own = renderToStaticMarkup(createElement(ExerciseMediaPicker, { exerciseName: "Goblet Squat", videoPath: null, youtubeUrl: "https://youtu.be/ownownownow", onChange: () => {} }));
    expect(own).not.toContain("Spotlight demo");
  });
  it("the Spotlight demo's video and link are never handed to the picker as the coach's (so Remove can never touch them)", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("videoPath={liveDemo && !liveDemo.storedUnder && !liveDemo.demo.platform ? liveDemo.demo.videoPath : null}");
    expect(card).toContain("platformDemo={!!liveDemo?.demo.platform}");
    expect(card).toContain("const own = liveDemo && !liveDemo.demo.platform ? liveDemo.demo : null;");
  });
});

describe("the database step", () => {
  it("one read function and one file-read rule; uploading and deleting unchanged", () => {
    const sql = read("supabase/migrations/0434_platform_demo_library.sql");
    expect(sql).toContain("revoke all on function public.platform_demo_rows() from public, anon;");
    expect(sql).toContain("grant execute on function public.platform_demo_rows() to authenticated;");
    expect(sql).toContain("and (l.video_path is not null or nullif(btrim(l.youtube_url), '') is not null)");
    expect(sql).toContain("create policy exercise_media_select_platform_demo on storage.objects for select to authenticated");
    expect(sql).not.toMatch(/for (insert|update|delete)/);
    expect(sql).not.toMatch(/alter table public\.exercise_library|policy [a-z_]+ on public\.exercise_library/);
  });
});
