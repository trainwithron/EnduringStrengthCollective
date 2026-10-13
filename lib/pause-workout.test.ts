import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "We don't really need a new button. We already have Complete Workout. When we hit that, it should say complete or pause or resume. If it is completed, it would just say congratulations."
// A pause is the existing "abandoned" state shown as Paused: nothing else in the app reads it as a skipped or missed workout, and it is never completed for him.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const exit = read("components/session/exit-workout-button.tsx");
const complete = read("components/session/complete-workout-button.tsx");
const logger = read("components/logging/session-logger.tsx");
const page = read("app/sessions/[sessionId]/page.tsx");
const overview = read("components/logging/workout-overview-view.tsx");
const home = read("components/coach/mobile/coach-mobile-home.tsx");

describe("Complete workout is where complete, pause and resume live", () => {
  it("tapping it opens the choice: Complete workout / Pause for now / Keep going", () => {
    const tap = complete.slice(complete.indexOf("function handleTap()"), complete.indexOf("async function handlePause()"));
    expect(tap).toContain("setConfirming(true)");
    expect(complete).toContain("Complete this workout, or pause it and pick it up later.");
    expect(complete).toContain("Pause for now");
    expect(complete).toContain("Keep going");
    expect(complete).toContain('.update({ status: "abandoned" })');
  });
  it("a completed workout shows a congratulations line and no buttons; a paused one shows Resume workout in the same place", () => {
    expect(page).toContain('finishedLine={session.status === "completed" ? "Done. Good workout." : null}');
    expect(page).toContain('pausedSessionId={session.status === "abandoned" ? session.id : null}');
    expect(logger).toContain("{isCompleted && finishedLine && (");
    expect(logger).toContain("<ResumeWorkoutButton sessionId={pausedSessionId} />");
    expect(logger).toContain("{!isCompleted && (\n        <CompleteWorkoutButton");
  });
  it("there is no separate Pause button: the top-left link only leaves, and leaving pauses", () => {
    expect(exit).toContain("&larr; Back");
    expect(exit).not.toContain("Pause workout");
    expect(exit).toContain('status: "abandoned"');
  });
  it("shows Paused for 48 hours, then Not finished, and ?resume=1 resumes where he left off", () => {
    expect(page).toContain('pausedRecently ? "Paused" : "Not finished"');
    expect(page).toContain("48 * 3600000");
    expect(page).toContain('query.resume === "1" && session.status === "abandoned"');
    expect(overview).toContain("?resume=1");
  });
  it("the coach's phone Home button becomes Resume workout while his own workout is paused or in progress", () => {
    expect(home).toContain('.in("status", ["in_progress", "abandoned"])');
    expect(home).toContain('"Resume workout" : "Start workout"');
    expect(home).toContain("?resume=1");
  });
});
