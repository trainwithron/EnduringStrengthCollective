import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionPatternFindings, evidenceRowText, evidenceSetText, findingLabel, patternSummary, type PatternSession, type PatternSet } from "./session-pattern-evidence";
import { pastSetDone } from "./set-complete";
import { PatternEvidence } from "@/components/coach/pattern-evidence";

// Oct 20: a coach was told Johann's first exercise "averages only 46% of prescribed sets completed". Every set was there: logged under the old checkbox rule, with weight and reps,
// but left "pending". A past set is done by the logger's own rule, not by its status alone.

const set = (order: number, over: Partial<PatternSet> = {}): PatternSet => ({ set_order: order, weight: 135, reps: 8, status: "pending", ...over });
let day = 0;
const session = (exercises: { name: string; order: number; sets: PatternSet[]; tracked?: string[] }[], minutes = 50): PatternSession => {
  day += 1;
  return {
    id: `s${day}`,
    started_at: `2026-09-${String(day).padStart(2, "0")}T16:00:00Z`,
    duration_seconds: minutes * 60,
    session_exercises: exercises.map((e) => ({ exercise_order: e.order, exercise_name: e.name, tracked_fields: e.tracked ?? ["reps", "weight"], group_workout_exercise_id: null, set_logs: e.sets })),
  };
};

describe("a past set is done by the logger's own rule", () => {
  it("completed, or filled with what the exercise tracks; never a skipped set; weight is optional for a bodyweight movement", () => {
    const ex = { tracked_fields: ["reps", "weight"], exercise_name: "Barbell Back Squat" };
    expect(pastSetDone({ status: "completed" }, ex)).toBe(true);
    expect(pastSetDone({ status: "pending", weight: 135, reps: 8 }, ex)).toBe(true);
    expect(pastSetDone({ status: "pending", weight: 135, reps: null }, ex)).toBe(false);
    expect(pastSetDone({ status: "pending", weight: null, reps: null }, ex)).toBe(false);
    expect(pastSetDone({ status: "skipped", weight: 135, reps: 8 }, ex)).toBe(false);
    expect(pastSetDone({ status: "pending", weight: null, reps: 12 }, { tracked_fields: ["reps", "weight"], exercise_name: "Push-up" })).toBe(true);
    expect(pastSetDone({ status: "pending", time_seconds: 45 }, { tracked_fields: ["time"], exercise_name: "Plank" })).toBe(true);
    // no tracked fields saved: the default (reps and weight)
    expect(pastSetDone({ status: "pending", weight: 95, reps: 10 }, { exercise_name: "Bench Press" })).toBe(true);
  });
});

describe("the struggle point", () => {
  it("Johann-like data (every first-exercise set filled, left pending) is not a struggle", () => {
    const sessions = Array.from({ length: 6 }, () =>
      session([
        { name: "Barbell Back Squat", order: 0, sets: [set(0), set(1), set(2)] },
        { name: "Romanian Deadlift", order: 1, sets: [set(0, { status: "completed" }), set(1, { status: "completed" })] },
      ])
    );
    expect(buildSessionPatternFindings(sessions, new Map()).find((f) => f.kind === "struggle_point")).toBeUndefined();
  });
  it("a slot really skipped is found, with its exercise, and the evidence shows each session's sets", () => {
    const sessions = Array.from({ length: 5 }, () =>
      session([
        { name: "Barbell Back Squat", order: 0, sets: [set(0), set(1, { status: "completed" }), set(2, { weight: null, reps: null })] },
        { name: "Romanian Deadlift", order: 1, sets: [set(0), set(1)] },
      ])
    );
    const f = buildSessionPatternFindings(sessions, new Map()).find((x) => x.kind === "struggle_point");
    expect(f).toBeDefined();
    expect(f!.description).toBe("Exercise slot #0 (Barbell Back Squat) is only getting 67% of its prescribed sets completed on average.");
    expect(f!.numericValues).toEqual([67, 0]);
    expect(f!.evidence?.kind).toBe("slot_sets");
    if (f!.evidence?.kind === "slot_sets") {
      expect(f!.evidence.rows).toHaveLength(5);
      expect(f!.evidence.rows[0]).toMatchObject({ exerciseName: "Barbell Back Squat", done: 2, total: 3 });
      // newest first
      expect(f!.evidence.rows[0].startedAt > f!.evidence.rows[4].startedAt).toBe(true);
      expect(f!.evidence.rows[0].sets.map((s) => evidenceSetText(s))).toEqual(["135 x 8", "135 x 8", "not logged"]);
      expect(f!.evidence.slotLabel).toBe("the first exercise");
    }
  });
});

describe("the other findings carry their evidence", () => {
  it("RPE creep: each session's average RPE, newest first", () => {
    const rpes = [8.5, 8.5, 8.5, 7, 7, 7];
    const sessions = rpes.map((rpe) => session([{ name: "Bench Press", order: 0, sets: [set(0, { rpe, status: "completed" })] }]));
    const f = buildSessionPatternFindings(sessions, new Map()).find((x) => x.kind === "rpe_creep");
    expect(f?.evidence).toEqual({ kind: "session_rpe", rows: sessions.slice().reverse().map((s, i) => ({ startedAt: s.started_at, avgRpe: rpes.slice().reverse()[i] })) });
  });
  it("rest creep: each exercise's real rest against the plan", () => {
    const sessions = Array.from({ length: 4 }, () =>
      session([{ name: "Bench Press", order: 0, sets: [set(0, { rest_seconds: 180, status: "completed" }), set(1, { rest_seconds: 180, status: "completed" })] }])
    );
    for (const s of sessions) s.session_exercises![0].group_workout_exercise_id = "gwe1";
    const targets = new Map([["gwe1:0", 90], ["gwe1:1", 90]]);
    const f = buildSessionPatternFindings(sessions, targets).find((x) => x.kind === "rest_time_creep");
    expect(f?.evidence).toEqual({ kind: "rest", rows: [{ exerciseName: "Bench Press", actualSeconds: 180, targetSeconds: 90, sets: 8 }] });
  });
  it("weekday rushing: that weekday's sessions and their minutes, in the coach's own time zone", () => {
    // Mondays in Las Vegas at 6 PM are Tuesdays in UTC: grouped as Mondays.
    const mk = (iso: string, minutes: number): PatternSession => ({ id: iso, started_at: iso, duration_seconds: minutes * 60, session_exercises: [] });
    const sessions = [
      mk("2026-09-01T01:00:00Z", 20), // Mon Aug 31, 6 PM PDT
      mk("2026-09-02T16:00:00Z", 60),
      mk("2026-09-08T01:00:00Z", 20), // Mon Sep 7
      mk("2026-09-09T16:00:00Z", 60),
      mk("2026-09-15T01:00:00Z", 20), // Mon Sep 14
      mk("2026-09-16T16:00:00Z", 60),
    ];
    const f = buildSessionPatternFindings(sessions, new Map(), "America/Los_Angeles").find((x) => x.kind === "weekday_rushing");
    expect(f?.description).toBe("Monday sessions usually run 20 min, against 40 min for sessions overall.");
    if (f?.evidence?.kind === "durations") expect(f.evidence.rows.map((r) => r.minutes)).toEqual([20, 20, 20]);
  });
});

describe("the evidence on the finding screen", () => {
  it("one compact row per session: the date, the exercise, 2 of 3 sets, and the sets as logged", () => {
    const html = renderToStaticMarkup(
      createElement(PatternEvidence, {
        evidence: {
          kind: "slot_sets",
          slotLabel: "the first exercise",
          sessions: 6,
          rows: [{ startedAt: "2026-10-06T23:00:00Z", exerciseName: "Barbell Back Squat", done: 2, total: 3, sets: [{ done: true, weight: 135, reps: 8, timeSeconds: null, distance: null }, { done: true, weight: 135, reps: 8, timeSeconds: null, distance: null }, { done: false, weight: null, reps: null, timeSeconds: null, distance: null }] }],
        },
        timeZone: "America/Los_Angeles",
        unit: "lb",
      })
    );
    expect(html).toContain("Tue, Oct 6");
    expect(html).toContain("Barbell Back Squat");
    expect(html).toContain("2 of 3 sets");
    expect(html).toContain("135 x 8, 135 x 8, not logged");
  });
  it("a session with nothing logged says not logged once, not a dash per set", () => {
    const empty = { done: false, weight: null, reps: 8, timeSeconds: null, distance: null };
    expect(evidenceRowText([empty, empty, empty])).toBe("not logged");
  });
  it("the screen works the findings out again with every set counted, shows the evidence, and has the phone's shell and a way back", () => {
    const page = readFileSync(join(__dirname, "..", "app/sessions/[sessionId]/coach-note/page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("gatherSessionPatternFindings(supabase as any, { athleteId: session.athlete_id, groupId: session.group_id, upTo: session.started_at as string })");
    expect(page).toContain("<PatternEvidence evidence={f.evidence} timeZone={tz} unit={unit} />");
    expect(page).toContain("patternSummary(");
    expect(page).toContain("<CoachMobileShell");
    expect(page).toContain("&larr; {athleteName}");
  });
  it("the graduation history and the other counting reads use the same rule", () => {
    for (const f of ["lib/graduation-server.ts", "lib/progress-look-gather.ts", "lib/session-recap-data.ts", "lib/session-integrity-data.ts", "lib/session-pattern-evidence.ts"]) {
      expect(readFileSync(join(__dirname, "..", f), "utf8"), f).toContain("pastSetDone(");
    }
  });
});

describe("the summary at the top never contradicts the rows under it (Johann, Oct 20)", () => {
  // Six sessions; four had the first exercise cut short (1 of 3 sets logged, the rest prefilled but never logged).
  const mk = (iso: string, name: string, logged: boolean): PatternSession => ({
    id: iso,
    started_at: iso,
    duration_seconds: 3000,
    session_exercises: [
      { exercise_order: 1, exercise_name: name, tracked_fields: ["reps", "weight"], group_workout_exercise_id: null, set_logs: [0, 1, 2].map((o) => (logged || o === 0 ? set(o) : set(o, { weight: null, reps: 8 }))) },
      { exercise_order: 2, exercise_name: "Romanian Deadlift", tracked_fields: ["reps", "weight"], group_workout_exercise_id: null, set_logs: [set(0), set(1)] },
    ],
  });
  const sessions = [
    mk("2026-09-14T23:00:00Z", "Barbell Back Squat", true),
    mk("2026-09-16T23:00:00Z", "Barbell Back Squat", false),
    mk("2026-09-21T23:00:00Z", "Barbell Back Squat", false),
    mk("2026-09-28T23:00:00Z", "Cable Lat Pulldown", false),
    mk("2026-10-01T23:00:00Z", "Barbell Back Squat", false),
    mk("2026-10-06T23:00:00Z", "Barbell Back Squat", true),
  ];
  const findings = buildSessionPatternFindings(sessions, new Map(), "America/Los_Angeles");
  const stored = [{ kind: "struggle_point", numericValues: [46, 1] }];
  it("the numbers differ from the stored note: the summary is built from what is found now, naming the sessions and exercises", () => {
    expect(findings.find((f) => f.kind === "struggle_point")?.numericValues[0]).toBe(56);
    expect(patternSummary(findings, stored, "Exercise slot #1 (often the first exercise) is only getting 46% ...", "America/Los_Angeles")).toBe(
      "Worth a look: the first exercise was cut short in 4 of the last 6 sessions (Sep 16 Barbell Back Squat, Sep 21 Barbell Back Squat, Sep 28 Cable Lat Pulldown, Oct 1 Barbell Back Squat)."
    );
  });
  it("the same findings with the same numbers keep the note as written", () => {
    const same = findings.map((f) => ({ kind: f.kind, numericValues: f.numericValues }));
    expect(patternSummary(findings, same, "The note as written.", "America/Los_Angeles")).toBe("The note as written.");
  });
  it("nothing found now says so", () => {
    expect(patternSummary([], stored, "old", "UTC")).toBe("Looked at again with every logged set counted, nothing stands out in these sessions now.");
  });
  it("the sentence is said once: with one finding the rows follow it straight away; with several, each gets a short label", () => {
    const page = readFileSync(join(__dirname, "..", "app/sessions/[sessionId]/coach-note/page.tsx"), "utf8");
    expect(page).toContain("{findings.length > 1 && <p className=\"font-body text-sm text-chalk\">{findingLabel(f)}</p>}");
    expect(page).not.toContain("findingSentence(");
    const struggle = findings.find((f) => f.kind === "struggle_point")!;
    expect(findingLabel(struggle)).toBe("Sets missing in the first exercise");
    expect(findingLabel({ kind: "rpe_creep", description: "", numericValues: [] })).toBe("Effort (RPE) dropping");
    expect(findingLabel({ kind: "rest_time_creep", description: "(consistently longer than programmed)", numericValues: [] })).toBe("Resting longer than planned");
    expect(findingLabel({ kind: "weekday_rushing", description: "", numericValues: [], evidence: { kind: "durations", weekday: "Monday", overallMinutes: 40, rows: [] } })).toBe("Monday sessions running short");
  });
  it("the page uses it", () => {
    const page = readFileSync(join(__dirname, "..", "app/sessions/[sessionId]/coach-note/page.tsx"), "utf8");
    expect(page).toContain("patternSummary(findings, stored, check.synthesis_text, tz)");
    expect(page).not.toContain("? check.synthesis_text");
  });
});
