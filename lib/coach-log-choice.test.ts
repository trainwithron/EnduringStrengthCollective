import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PICK_LABEL, VIEW_PROGRAM_LABEL, buildLogChoices, exerciseCountLine, startLabel, weekdayName } from "@/lib/coach-log-choice";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: the coach's Log page jumped straight into today's single workout, so he only ever saw Tuesday, and Back to program bounced back into the same day (a loop). "It should start there, but it
// shouldn't take up the whole screen: start Tuesday's workout or view whole program."
describe("the coach's Log a workout choice", () => {
  it("says Start [Day]'s workout, on the coach's clock", () => {
    expect(startLabel("Tuesday")).toBe("Start Tuesday's workout");
    expect(weekdayName(new Date("2026-10-13T20:00:00Z"), "America/Los_Angeles")).toBe("Tuesday");
    expect(weekdayName(new Date("2026-10-14T03:00:00Z"), "America/Los_Angeles")).toBe("Tuesday");
    expect(VIEW_PROGRAM_LABEL).toBe("View whole program");
    expect(PICK_LABEL).toBe("Pick a workout");
    expect(exerciseCountLine(1)).toBe("1 exercise");
    expect(exerciseCountLine(6)).toBe("6 exercises");
  });
  it("one card per program: Start when something is due today, Done when it is logged, Pick when nothing is due", () => {
    const programs = [
      { programId: "p1", name: "Strength", label: null },
      { programId: "p2", name: "Mobility Flow", label: "Mobility" },
      { programId: "p3", name: "Conditioning", label: null },
    ];
    const cards = [
      { programId: "p1", heading: "Strength", status: "ready" as const, workoutId: "w1", title: "Lower" },
      { programId: "p2", heading: "Mobility", status: "done" as const, workoutId: "w2", title: "Hips" },
    ];
    const out = buildLogChoices(programs, cards, { w1: 6, w2: 4 });
    expect(out.map((c) => c.kind)).toEqual(["start", "done", "pick"]);
    expect(out[0]).toMatchObject({ workoutId: "w1", title: "Lower", exerciseCount: 6, heading: "Strength" });
    expect(out[1]).toMatchObject({ heading: "Mobility", exerciseCount: 4 });
    expect(out[2]).toMatchObject({ workoutId: null, heading: "Conditioning" });
  });
});

describe("the Log page never jumps into a day and never loops", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/page.tsx");
  it("no automatic redirect into a workout", () => {
    expect(page).not.toContain("redirect(`/groups/${params.groupId}/athletes/${params.athleteId}/log/");
    expect(page).not.toMatch(/redirect\(`[^`]*\/log\/\$\{/);
  });
  it("it offers the choice, and the whole program (every week and day open for the coach, Log this workout on each day)", () => {
    expect(page).toContain("startLabel(weekday)");
    expect(page).toContain("VIEW_PROGRAM_LABEL");
    expect(page).toContain("<ProgramPlainView");
    expect(page).toContain("isCoach");
    expect(page).toContain("subjectId={params.athleteId}");
    expect(page).toContain('startLabel="Log this workout"');
    expect(page).toContain("workoutHrefBase={logBase}");
    expect(page).toContain("backHref={logBase}");
  });
  it("the program view is never locked for the coach (the coach's own visibility setting is the only lock, and not for the coach)", () => {
    expect(read("components/shared/program-plain-view-server.tsx")).toContain("const locked = !isCoach && when");
  });
  it("Back to program from a day goes to the program view, not to a page that jumps back into a day", () => {
    const day = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/log/[workoutId]/page.tsx");
    expect(day).toContain("const backHref = programRow?.program_id ? `${logBase}?program=${programRow.program_id}` : logBase;");
    expect(day).toContain("backHref={backHref}");
  });
  it("only a program this client follows can be opened by the ?program= link", () => {
    expect(page).toContain("programs.find((p) => p.id === searchParams.program)");
  });
});
