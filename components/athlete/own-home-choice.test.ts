import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startLabel, VIEW_PROGRAM_LABEL, weekdayName } from "@/lib/coach-log-choice";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: the coach's own Home card gets the same small choice as the client Log page: "Start [Day]'s workout" and "View whole program".
describe("a coach's own Home card offers the same small choice", () => {
  it("reads the weekday of the card's own date", () => {
    expect(startLabel(weekdayName(new Date("2026-10-13T12:00:00Z"), "UTC"))).toBe("Start Tuesday's workout");
    expect(startLabel(weekdayName(new Date("2026-10-18T12:00:00Z"), "UTC"))).toBe("Start Sunday's workout");
    expect(VIEW_PROGRAM_LABEL).toBe("View whole program");
  });
  it("only a coach looking at their own training gets it; a client's Home is unchanged", () => {
    const page = read("app/(coach)/groups/[groupId]/page.tsx");
    expect(page).toContain("ownChoice={isCoach && !isActingAsOther && athleteId === user?.id}");
    const card = read("components/athlete/day-card.tsx");
    expect(card).toContain('ownChoice ? startLabel(weekdayOfDate(dateKey)) : "Start workout"');
    expect(card).toContain("ownChoice && x.status === \"planned\" && isToday");
    expect(card).toContain("ownChoice && isToday && workout.status === \"planned\"");
    expect(card).toContain("`/groups/${groupId}/programs/${programId}`");
    expect(card).toContain("ownChoice = false");
  });
});
