import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repMaxTable, repMaxTablesByLift } from "@/lib/rep-maxes";
import { prHeadline, prRepNote, prSetText, prShoutout, sharedPrTitle, workoutDonePushBody } from "@/lib/pr-wording";
import { loadPrSets } from "@/lib/pr-sets";
import { defaultPair, gapWords, orderPair, photoDays, weightNear } from "@/lib/photo-compare";
import { recapYearFor, yearRecap, RECAP_MIN_WORKOUTS, type RecapLog } from "@/lib/year-recap";
import { measurementChange, measurementSeries, parseTape, showTape, tapeUnitFor, type MeasurementRow } from "@/lib/body-measurements";

// Wave 2, client progress (Ron, Nov 20): the data and the rules behind My progress (P1), the best at each rep count (P2), named PR notices (P3), tape measurements
// (P6), photo compare (P5) and the December recap (P7). The screens follow the approved mockups.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("P2: best at each rep count", () => {
  const sets = [
    { weight: 225, reps: 5, at: "2026-10-01" },
    { weight: 245, reps: 3, at: "2026-10-08" },
    { weight: 265, reps: 1, at: "2026-10-15" },
    { weight: 185, reps: 10, at: "2026-09-01" },
    { weight: 315, reps: 2, setType: "warmup", at: "2026-10-20" }, // a warm-up never counts
    { weight: 300, reps: 1, setType: "drop", at: "2026-10-21" }, // nor a drop set
    { weight: null, reps: 8, at: "2026-10-22" },
    { weight: 135, reps: null, at: "2026-10-22" },
  ];
  const t = repMaxTable(sets);
  const at = (n: number) => t.rows.find((r) => r.reps === n);
  it("the heaviest weight done for at least that many reps, so 225 × 5 also stands for 3 and 4, and the table reads downhill", () => {
    expect(at(1)).toMatchObject({ weight: 265, fromReps: 1 });
    expect(at(2)).toMatchObject({ weight: 245, fromReps: 3 });
    expect(at(3)).toMatchObject({ weight: 245, fromReps: 3 });
    expect(at(4)).toMatchObject({ weight: 225, fromReps: 5 });
    expect(at(5)).toMatchObject({ weight: 225, fromReps: 5, at: "2026-10-01" });
    expect(at(6)).toMatchObject({ weight: 185, fromReps: 10 });
    expect(at(10)).toMatchObject({ weight: 185 });
    expect(at(11)).toBeUndefined();
    const weights = t.rows.map((r) => r.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });
  it("warm-ups and drop sets never count, and the estimated max comes from the strongest counted set", () => {
    expect(t.rows.every((r) => r.weight < 300)).toBe(true);
    expect(t.estimatedMax).not.toBeNull();
    expect(t.estimatedMax!.weight).toBeLessThan(300);
  });
  it("at the same weight, the first time it was reached", () => {
    expect(repMaxTable([{ weight: 200, reps: 5, at: "2026-11-01" }, { weight: 200, reps: 5, at: "2026-10-01" }]).rows[0].at).toBe("2026-10-01");
  });
  it("one table per lift, named as most recently written", () => {
    const by = repMaxTablesByLift([
      { exerciseName: "back squat", weight: 200, reps: 5, at: "2026-01-01" },
      { exerciseName: "Back Squat", weight: 210, reps: 5, at: "2026-02-01" },
      { exerciseName: "Plank", weight: null, reps: null, at: "2026-02-01" },
    ]);
    expect([...by.keys()]).toEqual(["Back Squat"]);
    expect(by.get("Back Squat")!.rows.find((r) => r.reps === 5)!.weight).toBe(210);
  });
});

describe("P1: My progress reads the coach's cards as the client, read-only", () => {
  const src = read("lib/my-progress.ts");
  it("the same rollup, cards and stats as the coach's Progress tab, with the client's own access", () => {
    expect(src).toContain('supabase.rpc("client_exercise_rollup", { p_athlete: athleteId, p_group: groupId })');
    expect(src).toContain("const plan = planCards(summarizeExercises(rollup), ladders, pinned);");
    expect(src).toContain("...importedWorkouts(rollup).map((w) => ({ date: dateKeyInZone(w.at, timeZone), volume: w.volume })),");
    expect(src).toContain("for (const pr of hindsightPrs(rollup)) prDates.push(pr.date);");
  });
  it("nothing in it writes", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("a failed read says the page is incomplete rather than showing nothing as if nothing was done", () => {
    expect(src).toContain("if (rollupRes.error || logsRes.error) incomplete = true;");
  });
});

describe("P3: a PR notice names the lift, the weight and the reps", () => {
  const squat = { name: "Back Squat", weight: 225, reps: 5 };
  const bench = { name: "Bench Press", weight: 185, reps: 8 };
  it("New PR: Back Squat 225 × 5", () => {
    expect(prHeadline([squat])).toBe("New PR: Back Squat 225 × 5");
    expect(prHeadline([squat, bench])).toBe("New PRs: Back Squat 225 × 5 and Bench Press 185 × 8");
    expect(prHeadline([squat, bench, { name: "Row", weight: 135, reps: 10 }])).toBe("New PRs: Back Squat 225 × 5 and 2 more");
    expect(prHeadline([])).toBe("");
    expect(prSetText({ name: "Mile Run", weight: null, reps: null })).toBe("Mile Run");
    expect(prSetText({ name: "Curl", weight: 32.5, reps: 12 })).toBe("Curl 32.5 × 12");
  });
  it("the coach's push says what the record was, never a bare 'new PR!'", () => {
    expect(workoutDonePushBody("Sam", [squat], [])).toBe("Sam completed a workout. New PR: Back Squat 225 × 5 🎉");
    expect(workoutDonePushBody("Sam", [], [squat])).toBe("Sam completed a workout. New group record: Back Squat 225 × 5 🏆");
    expect(workoutDonePushBody("Sam", [], [])).toBe("Sam completed a workout");
    const button = read("components/session/complete-workout-button.tsx");
    expect(button).not.toContain("new PR! 🎉");
    expect(button).toContain("workoutDonePushBody(athleteName,");
    expect(button).toContain("loadPrSets(supabase, { athleteId: result.athlete_id, sessionId, names: [...newPrs, ...newRecords] })");
  });
  it("the share card says what the record beat; the shared page's title and Home's shout-out name it", () => {
    expect(prRepNote(5)).toBe("best ever at 5 reps");
    expect(prRepNote(1)).toBe("best ever for 1 rep");
    expect(read("lib/shared-workout.ts")).toContain("`${prRepNote(best.reps)} · est. 1RM ${estimateOneRepMax(best.weight, best.reps)} lbs`");
    expect(sharedPrTitle("Sam", [{ name: "Back Squat", primary: "225 lbs × 5" }])).toBe("Sam just hit a new PR: Back Squat 225 lbs × 5 🎉");
    expect(read("app/share/[postId]/page.tsx")).not.toContain("just hit a new PR! 🎉");
    expect(prShoutout("Sam", ["Back Squat", "Bench"])).toBe("Sam just hit a new PR on Back Squat and 1 more — worth a shoutout.");
    expect(read("lib/dashboard-data.ts")).toContain('text: prShoutout(athlete?.fullName ?? "A client", recentPrLog.new_prs ?? []),');
  });
  it("the set behind each record follows the one record rule, strongest first; a lift it cannot read is still named", async () => {
    const rows = (list: [string, number, number, string?][], session: string) =>
      list.map(([name, weight, reps, setType]) => ({ weight, reps, set_type: setType ?? "working", status: "completed", session_exercises: { session_id: session, exercise_name: name } }));
    const thisSession = rows([["Back Squat", 225, 5], ["Back Squat", 205, 8], ["Bench", 185, 3], ["Bench", 225, 1, "warmup"]], "s1");
    const prior = rows([["Back Squat", 215, 5], ["Back Squat", 205, 8], ["Bench", 175, 3]], "s0");
    let call = 0;
    const fake: any = {
      from: () => {
        const q: any = { select: () => q, eq: () => q, in: () => q, neq: () => q, then: (r: any) => r({ data: call++ === 0 ? thisSession : prior, error: null }) };
        return q;
      },
    };
    const found = await loadPrSets(fake, { athleteId: "a", sessionId: "s1", names: ["Bench", "Back Squat", "Mile"] });
    expect(found).toEqual([
      { name: "Back Squat", weight: 225, reps: 5 },
      { name: "Bench", weight: 185, reps: 3 },
      { name: "Mile", weight: null, reps: null },
    ]);
    const broken: any = { from: () => { throw new Error("down"); } };
    expect(await loadPrSets(broken, { athleteId: "a", sessionId: "s1", names: ["Bench"] })).toEqual([{ name: "Bench", weight: null, reps: null }]);
  });
});

describe("P6: tape measurements", () => {
  it("inches for pounds people, centimetres for kilogram people; stored as inches", () => {
    expect(tapeUnitFor("lb")).toBe("in");
    expect(tapeUnitFor("kg")).toBe("cm");
    expect(parseTape("waist", "86.4", "cm")).toEqual({ ok: true, inches: 34.02 });
    expect(showTape(34.02, "cm")).toBe(86.4);
    expect(parseTape("waist", "", "in")).toEqual({ ok: true, inches: null });
  });
  it("a number the table would refuse is caught first, in the person's unit", () => {
    expect(parseTape("arm", "1", "in")).toEqual({ ok: false, message: "Arm looks off. Use 3 to 40 in." });
    expect(parseTape("waist", "500", "cm")).toEqual({ ok: false, message: "Waist looks off. Use 25 to 254 cm." });
    expect(parseTape("hips", "abc", "in").ok).toBe(false);
  });
  it("one graph per measurement, oldest first, and the change since the first reading", () => {
    const rows: MeasurementRow[] = [
      { date: "2026-11-08", waist: 33, hips: null, chest: 41, arm: null, thigh: null },
      { date: "2026-10-01", waist: 35, hips: 40, chest: null, arm: null, thigh: null },
    ];
    expect(measurementSeries(rows, "waist", "in")).toEqual([{ date: "2026-10-01", value: 35 }, { date: "2026-11-08", value: 33 }]);
    expect(measurementChange(rows, "waist", "in")).toBe(-2);
    expect(measurementChange(rows, "hips", "in")).toBeNull();
  });
  it("the table, its paste and its rehearsal exist; the reads are soft before the paste", () => {
    const mig = read("supabase/migrations/0457_body_measurements.sql");
    expect(mig).toContain("constraint body_measurements_one_per_day unique (athlete_id, measured_on)");
    expect(mig).toContain("using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));");
    expect(read("supabase/apply/apply-step213-0457.sql")).toContain("-- Check: one row, all true.");
    expect(read("supabase/apply/undo-step213-0457.sql")).toContain("drop table if exists public.body_measurements;");
    expect(read("lib/body-measurements.ts")).toContain("if (error) return [];");
  });
});

describe("P5: photo compare", () => {
  const photos = [
    { id: "c", takenDate: "2026-11-01", storagePath: "x/c.jpg" },
    { id: "a", takenDate: "2026-08-01", storagePath: "x/a.jpg" },
    { id: "b", takenDate: "2026-08-01", storagePath: "x/b.jpg" },
    { id: "z", takenDate: "not a date", storagePath: "x/z.jpg" },
  ];
  it("days oldest first; it opens on the first and latest day; a chosen pair is put in order", () => {
    const days = photoDays(photos);
    expect(days.map((d) => [d.date, d.photos.length])).toEqual([["2026-08-01", 2], ["2026-11-01", 1]]);
    expect(defaultPair(days)).toEqual({ before: "2026-08-01", after: "2026-11-01" });
    expect(defaultPair(days.slice(0, 1))).toBeNull();
    expect(orderPair("2026-11-01", "2026-08-01")).toEqual({ before: "2026-08-01", after: "2026-11-01" });
    expect(orderPair("2026-11-01", "2026-11-01")).toBeNull();
  });
  it("the weigh-in nearest each photo, within a week", () => {
    const w = [{ date: "2026-07-29", weight: 190 }, { date: "2026-08-03", weight: 189 }, { date: "2026-10-01", weight: 180 }];
    expect(weightNear("2026-08-01", w)).toEqual({ date: "2026-08-03", weight: 189 });
    // a tie goes to the earlier weigh-in
    expect(weightNear("2026-08-01", [{ date: "2026-08-03", weight: 189 }, { date: "2026-07-30", weight: 190 }])).toEqual({ date: "2026-07-30", weight: 190 });
    expect(weightNear("2026-11-01", w)).toBeNull();
    expect(gapWords("2026-08-01", "2026-11-01")).toBe("3 months apart");
    expect(gapWords("2026-08-01", "2026-09-26")).toBe("8 weeks apart");
    expect(gapWords("2026-08-01", "2026-08-06")).toBe("5 days apart");
    expect(gapWords("2025-08-01", "2026-11-01")).toBe("1 year 3 months apart");
  });
});

describe("P7: the December recap", () => {
  const logs = (n: number, month = "06"): RecapLog[] =>
    Array.from({ length: n }, (_, i) => ({ createdAt: `2026-${month}-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`, totalVolume: 1000, totalSets: 10, durationSeconds: 3600, newPrs: i === 0 ? ["Back Squat", "Bench"] : i === 1 ? ["back squat"] : [] }));
  const key = (iso: string) => iso.slice(0, 10);
  it("offered Dec 1 to Jan 15 for the year ending", () => {
    expect(recapYearFor("2026-12-01")).toBe(2026);
    expect(recapYearFor("2027-01-15")).toBe(2026);
    expect(recapYearFor("2027-01-16")).toBeNull();
    expect(recapYearFor("2026-11-30")).toBeNull();
  });
  it("needs at least 10 workouts in the year", () => {
    expect(yearRecap(2026, logs(RECAP_MIN_WORKOUTS - 1), [], key)).toBeNull();
    expect(yearRecap(2025, logs(20), [], key)).toBeNull();
  });
  it("the year in numbers: workouts, volume, minutes, records (by lift), best month, weeks in a row, top lifts", () => {
    const r = yearRecap(2026, [...logs(12, "06"), ...logs(3, "07")], [{ name: "Back Squat", sessions: 9 }, { name: "Bench", sessions: 12 }, { name: "Row", sessions: 2 }, { name: "Curl", sessions: 1 }], key)!;
    expect(r.workouts).toBe(15);
    expect(r.volume).toBe(15000);
    expect(r.minutes).toBe(900);
    expect(r.prCount).toBe(6);
    expect(r.prLifts[0]).toBe("Back Squat");
    expect(r.bestMonth).toEqual({ month: 6, workouts: 12 });
    expect(r.longestWeekStreak).toBeGreaterThanOrEqual(2);
    expect(r.topLifts.map((l) => l.name)).toEqual(["Bench", "Back Squat", "Row"]);
  });
});

describe("P1 screen: My progress", () => {
  it("the estimated-max line is one point a day (the day's best), oldest first, in the person's own day", async () => {
    const { e1rmSeriesFor, changeOver } = await import("@/lib/progress-lines");
    const rollup = [
      { exerciseName: "Back Squat", at: "2026-11-01T15:00:00Z", bestE1rm: 250 },
      { exerciseName: "back squat", at: "2026-11-01T20:00:00Z", bestE1rm: 255 },
      { exerciseName: "Back Squat", at: "2026-08-01T15:00:00Z", bestE1rm: 235 },
      { exerciseName: "Bench", at: "2026-08-01T15:00:00Z", bestE1rm: 200 },
      { exerciseName: "Back Squat", at: "2026-09-01T15:00:00Z", bestE1rm: null },
    ];
    const line = e1rmSeriesFor(rollup, "Back Squat", "America/Chicago");
    expect(line).toEqual([{ date: "2026-08-01", value: 235 }, { date: "2026-11-01", value: 255 }]);
    // +20 since Aug 1 (the window reaches back past the first point, so it says since when)
    expect(changeOver(line, "2026-11-20")).toEqual({ delta: 20, since: "2026-08-01", fullWindow: true });
    expect(changeOver([{ date: "2026-11-01", value: 1 }, { date: "2026-11-10", value: 3 }], "2026-11-20")).toEqual({ delta: 2, since: "2026-11-01", fullWindow: false });
    expect(changeOver(line.slice(0, 1), "2026-11-20")).toBeNull();
  });
  it("read-only, the client's own (or as the coach sees them as the client), with the best-at-each-rep table, Photos, Measurements and the recap link in December", () => {
    const page = read("app/(coach)/groups/[groupId]/progress/page.tsx");
    expect(page).toContain("const { athleteId } = await getEffectiveAthlete(params.groupId, user.id);");
    expect(page).toContain("loadMyProgress(supabase, { athleteId, groupId: params.groupId, timeZone })");
    const view = read("components/athlete/progress/my-progress-view.tsx");
    expect(view).toContain("Best at each rep count");
    expect(view).toContain("href={`/groups/${groupId}/progress/photos`}");
    expect(view).toContain("href={`/groups/${groupId}/progress/measurements`}");
    expect(view).toContain("{recapYear != null && (");
    expect(view).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("on the client's More page, first in Training", () => {
    expect(read("lib/more-links.ts")).toContain('training.unshift({ label: "My progress", hint: "Your lifts, best sets, photos and measurements", href: `${g}/progress` });');
  });
});
