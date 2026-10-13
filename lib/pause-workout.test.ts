import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "a way to pause my workouts instead of just finish them or complete them." A pause is the existing "abandoned" state shown as Paused: nothing else in the app reads it as a skipped or
// missed workout, and it is never completed for him.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const exit = read("components/session/exit-workout-button.tsx");
const page = read("app/sessions/[sessionId]/page.tsx");
const overview = read("components/logging/workout-overview-view.tsx");
const home = read("components/coach/mobile/coach-mobile-home.tsx");

describe("pause workout", () => {
  it("says Pause, with the approved confirmation", () => {
    expect(exit).toContain("Pause this workout? Everything you&apos;ve logged is saved. You can pick it up again later today.");
    expect(exit).toContain("&larr; Pause workout");
    expect(exit).toContain('exiting ? "Pausing…" : "Pause workout"');
    expect(exit).not.toContain("Exit workout");
    expect(exit).toContain('status: "abandoned"');
  });
  it("shows Paused for 48 hours, then Not finished, and ?resume=1 resumes where he left off", () => {
    expect(page).toContain('pausedRecently ? "Paused" : "Not finished"');
    expect(page).toContain("48 * 3600000");
    expect(page).toContain('query.resume === "1" && session.status === "abandoned"');
    expect(page).toContain('.update({ status: "in_progress" })');
    expect(overview).toContain("?resume=1");
  });
  it("the coach's phone Home button becomes Resume workout while his own workout is paused or in progress", () => {
    expect(home).toContain('.in("status", ["in_progress", "abandoned"])');
    expect(home).toContain('"Resume workout" : "Start workout"');
    expect(home).toContain("?resume=1");
  });
  it("nothing else reads the paused state as skipped (it is only written by Pause and read by Resume)", () => {
    const hits = ["lib/streaks.ts", "lib/todays-workout.ts"].filter((f) => {
      try {
        return read(f).includes("abandoned");
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });
});
