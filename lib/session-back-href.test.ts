import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionBackHref } from "@/lib/session-back-href";

describe("Back from a session", () => {
  const base = { groupId: "g1", athleteId: "a1", workoutId: "w1" };
  it("a coach logging for a client goes to that client's log overview for the day, in coach mode", () => {
    expect(sessionBackHref({ ...base, coachMode: true })).toBe("/groups/g1/athletes/a1/log/w1");
  });
  it("with no workout on the session it goes to the client's log page", () => {
    expect(sessionBackHref({ ...base, workoutId: null, coachMode: true })).toBe("/groups/g1/athletes/a1/log");
  });
  it("everyone else keeps the group's workout page, or the group's Home with no workout", () => {
    expect(sessionBackHref({ ...base, coachMode: false })).toBe("/groups/g1/workouts/w1");
    expect(sessionBackHref({ ...base, workoutId: null, coachMode: false })).toBe("/groups/g1");
  });
  it("the session page uses it for the Back link and the in-progress exit button, with the coach-mode flag", () => {
    const page = readFileSync("app/sessions/[sessionId]/page.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("sessionBackHref({ groupId: session.group_id, athleteId: session.athlete_id, workoutId: session.workout_id, coachMode: !!coachModeClient })");
    expect(page).toContain("<ExitWorkoutButton sessionId={session.id} backHref={backHref} />");
    expect(page).toContain('<Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">');
  });
});
