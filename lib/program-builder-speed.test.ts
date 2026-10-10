import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the program builder reads its data in two rounds, not eleven", () => {
  const data = read("lib/program-builder-data.ts");
  const body = data.slice(data.indexOf("export async function getProgramBuilderData"));
  it("the only serial wait is the program row; everything else is one batch", () => {
    const serial = body.split("\n").filter((l) => /^  (const|let) .*= await /.test(l));
    expect(serial.length).toBe(1);
    expect(serial[0]).toContain("const { data: program } = await supabase");
    expect((body.match(/\] = await Promise\.all\(/g) ?? []).length).toBe(1);
  });
  it("the batch holds the group, days, library, aliases, patterns, tiers, ladders, time zone, logged volume and the Spotter", () => {
    const batch = body.slice(body.indexOf("] = await Promise.all("), body.indexOf("const demoRows"));
    for (const needle of ['from("groups")', 'from("workouts")', 'from("exercise_library")', 'from("exercise_aliases")', 'from("movement_patterns")', "movement_pattern_exercises", "getGroupCoachTimezone(", 'from("workout_logs")', "gatherProgrammingSpotterFlags("]) {
      expect(batch).toContain(needle);
    }
  });
  it("ladders no longer wait for the pattern list: they are filtered by the pattern's owner", () => {
    expect(body).not.toContain('.in("movement_pattern_id", patternIds)');
    expect(body).toContain("difficulty_rank, movement_patterns!inner ( created_by )");
  });
  it("the time zone and logged volume are read only for a scheduled program, and volume is not a long list of ids", () => {
    expect(body).toContain("hasSchedule ? getGroupCoachTimezone(supabase, groupId)");
    expect(body).toContain('.eq("workouts.program_id", programId)');
    expect(body).not.toContain('.in("workout_id", workoutIds)');
  });
});

describe("the builder page and the Spotter", () => {
  const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
  it("access and the program are read together, and the builder's three reads are one batch", () => {
    expect(page).toContain("const [{ data: membership }, { data: program }] = await Promise.all([");
    expect(page).toContain("const [data, { data: roleRow, error: roleError }, { data: askedRule }] = await Promise.all([");
  });
  it("the Spotter reads the days and the dismissals together", () => {
    expect(read("lib/programming-spotter-gather.ts")).toContain("const [{ data: workouts }, { data: dismissalRows }] = await Promise.all([");
  });
});
