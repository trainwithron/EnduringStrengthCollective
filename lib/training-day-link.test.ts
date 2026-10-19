import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit: a client who trains Mon/Wed/Fri could only ask for or book a session on rest days, because a training day opened the workout and the booking day page was never reached.
describe("a training day on the client's program calendar", () => {
  const page = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx");
  it("opens the day page (workout card above the open times) when sessions are on offer, and the workout itself when they are not", () => {
    expect(page).toContain("href={daysTappable ? `${backHref}/calendar/${dateKey(date)}");
    expect(page).toContain(": `/groups/${params.groupId}/workouts/${w.id}`}");
  });
  it("the day page still shows that day's workout card above the open sessions", () => {
    const day = read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx");
    expect(day.indexOf("href={`/groups/${params.groupId}/workouts/${dayWorkout.id}`}")).toBeGreaterThan(0);
    expect(day.indexOf("href={`/groups/${params.groupId}/workouts/${dayWorkout.id}`}")).toBeLessThan(day.indexOf('"Open sessions"'));
  });
});
