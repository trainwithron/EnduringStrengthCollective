import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looksTooLong, validFixMinutes } from "./workout-time-fix";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, Nov 9: over 90 minutes asks "is this the correct time?", and the real length can be typed in hindsight.
describe("fixing a workout's time", () => {
  it("asks only over 90 minutes", () => {
    expect(looksTooLong(90 * 60)).toBe(false);
    expect(looksTooLong(90 * 60 + 1)).toBe(true);
    expect(looksTooLong(4 * 3600 + 12 * 60)).toBe(true);
    expect(looksTooLong(null)).toBe(false);
  });
  it("takes whole minutes from 1 to 600", () => {
    expect(validFixMinutes("60")).toBe(60);
    expect(validFixMinutes(60)).toBe(60);
    for (const bad of ["", "0", "-5", "45.5", "601", "abc", null, undefined]) expect(validFixMinutes(bad)).toBeNull();
  });
  it("only the client or a coach of the group may change it, and only the time changes", () => {
    const route = read("app/api/workouts/fix-time/route.ts");
    expect(route).toContain("session.athlete_id !== user.id");
    expect(route).toContain('supabase.rpc("is_group_coach", { _group_id: session.group_id })');
    expect(route).toContain("update({ total_duration_seconds: seconds })");
    expect(route).toContain("update({ duration_seconds: seconds })");
    expect(route).not.toMatch(/total_volume|new_prs|created_at|completed_at/);
  });
  it("Complete asks before finishing a long workout, and the typed time is saved before leaving", () => {
    const button = read("components/session/complete-workout-button.tsx");
    expect(button).toContain("Is that right?");
    expect(button).toContain("if (fixMinutes != null) await saveFixedTime(sessionId, fixMinutes);");
  });
  it("a long logged workout offers Fix time on its card", () => {
    expect(read("components/coach/logged-workout-card.tsx")).toContain("sessionId && looksTooLong(durationSeconds) && <FixWorkoutTime");
  });
});
