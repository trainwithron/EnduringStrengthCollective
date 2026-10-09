import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("every place that says when a locked workout opens uses the one real opening date", () => {
  it("the day card (via the day's workout info), the Today list and the phone home (via today's workout), the programs page and the workout page", () => {
    expect(read("lib/athlete-day-schedule.ts")).toContain("unlocksOn: unlockDate(match.date, visibilityWindow)");
    const today = read("lib/todays-workout.ts");
    expect(today.match(/unlockDate\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(today).not.toContain("unlocksOn: scheduledDate ?? null");
    expect(today).not.toContain("unlocksOn: nextDate ?? null");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("Unlocks {formatShortDate(unlockDate(scheduledDate!, program.visibility_window))}");
    expect(read("app/(coach)/groups/[groupId]/workouts/[workoutId]/page.tsx")).toContain("unlocks on {formatShortDate(unlockDate(scheduledDate!, program.visibility_window))}");
  });
  it("the Today page and the phone home show the date they are given, not the workout's own date", () => {
    expect(read("app/(coach)/groups/[groupId]/today/page.tsx")).toContain("formatShortDate(result.unlocksOn)");
    expect(read("components/coach/mobile/coach-mobile-home.tsx")).toContain("soloUnlocksOn = result.unlocksOn");
  });
});
