import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dayNotes, keptLine, listNames, MAX_KEPT_LINES, readKept, repairNote, takeRetry, type DayLookups } from "@/lib/builder-spotter";
import { readDayResult } from "@/lib/ai-day-run";

// The builder runs the Spotter on its own draft (reports/spotter-builder-crosscheck-ORDER.md, Part 2, Nov 24).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const info = (rows: [name: string, pattern: string | null, tags: string[], category?: string | null][]): DayLookups => ({
  patternByName: new Map(rows.filter((r) => r[1]).map(([n, p]) => [n, { id: p as string, tier: null }])),
  tagsByName: new Map(rows.map(([n, , t]) => [n, { keys: t, joints: t.map(() => null) }])),
  categoryByName: new Map(rows.map(([n, , , c]) => [n, (c ?? null) as never])),
});
const LOOK = info([
  ["Bent Over Barbell Row", "Horizontal Pull", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Pull"],
  ["Seated Cable Row", "Horizontal Pull", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Pull"],
  ["Chest Supported Row", "Horizontal Pull", ["shoulder_extension", "scapula_retraction", "elbow_flexion"], "Pull"],
  ["Dumbbell Curl", "Elbow Flexion (Biceps)", ["elbow_flexion", "forearm_supination"], "Pull"],
  ["Hammer Curl", "Elbow Flexion (Biceps)", ["elbow_flexion"], "Pull"],
  ["EZ Bar Curl", null, ["elbow_flexion"], "Pull"],
  ["Goblet Squat", "Squat", ["hip_extension", "knee_extension"], "Legs"],
  ["90/90 Hip Switch", null, ["hip_internal_rotation"], "Mobility"],
  ["Hip CARs", null, ["hip_internal_rotation"], "Mobility"],
  ["Pigeon Stretch", null, ["hip_internal_rotation"], "Mobility"],
]);
const day = (...names: string[]) => names.map((exerciseName) => ({ exerciseName }));
const none = new Set<string>();

describe("the builder's own check of one drafted day", () => {
  it("three rows back to back: one note, keyed like the Spotter's own Deny", () => {
    const notes = dayNotes(day("Goblet Squat", "Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row"), LOOK, none);
    expect(notes).toEqual([
      { key: "redundancy::Horizontal Pull", names: ["Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row"], problem: "Bent Over Barbell Row, Seated Cable Row and Chest Supported Row back to back on the same movement pattern" },
    ]);
  });
  it("three curls in a day: one note; a row and two curls: none (a row is not curl work)", () => {
    expect(dayNotes(day("Goblet Squat", "Dumbbell Curl", "Goblet Squat", "Hammer Curl", "EZ Bar Curl"), LOOK, none).map((n) => n.key)).toEqual(["biomech_redundancy::elbow_flexion"]);
    expect(dayNotes(day("Seated Cable Row", "Goblet Squat", "Dumbbell Curl", "Hammer Curl"), LOOK, none)).toEqual([]);
  });
  it("a mobility day's drills for one joint are the point of it", () => {
    expect(dayNotes(day("90/90 Hip Switch", "Hip CARs", "Pigeon Stretch"), LOOK, none)).toEqual([]);
  });
  it("what the coach already said no to on this program, or what this run already kept, is never raised or fixed", () => {
    const rows = day("Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row");
    expect(dayNotes(rows, LOOK, new Set(["redundancy::Horizontal Pull"]))).toEqual([]);
    expect(dayNotes(rows, LOOK, new Set(["redundancy::Vertical Pull"]))).toHaveLength(1);
  });
  it("a note on an exercise the coach named is theirs to decide", () => {
    const rows = [{ exerciseName: "Bent Over Barbell Row", coachNamed: true }, ...day("Seated Cable Row", "Chest Supported Row")];
    expect(dayNotes(rows, LOOK, none)).toEqual([]);
  });
  it("nothing known about the exercises (a failed read): no notes, the day is still built", () => {
    expect(dayNotes(day("Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row"), info([]), none)).toEqual([]);
  });
});

describe("one repair try, then a short line", () => {
  const note = dayNotes(day("Bent Over Barbell Row", "Seated Cable Row", "Chest Supported Row"), LOOK, none)[0];
  it("the repair note says what stacks, allows a focus day, and asks for the reason in \"kept\"", () => {
    const t = repairNote([note])!;
    expect(t).toContain("back to back on the same movement pattern");
    expect(t).toContain("unless the coach's request calls for that much of it");
    expect(t).toContain('"kept"');
    expect(repairNote([])).toBeNull();
  });
  it("kept on purpose: why, in a few words; no reason: worth a look", () => {
    expect(keptLine(note, { week: 1, day: 2 }, "back focus.")).toBe("Kept Bent Over Barbell Row, Seated Cable Row and Chest Supported Row in week 1, day 2: back focus.");
    expect(keptLine(note, { week: 1, day: 2 }, null)).toBe("Week 1, day 2 has Bent Over Barbell Row, Seated Cable Row and Chest Supported Row back to back on the same movement pattern. Worth a look.");
  });
  it("the model's reason is read as one short plain line, and readDayResult carries it", () => {
    expect(readKept("  back\nfocus\u0007 ")).toBe("back focus");
    expect(readKept("x".repeat(200))).toHaveLength(80);
    expect(readKept(3)).toBeNull();
    const day1 = { title: "Pull", exercises: [{ exerciseName: "Row", sets: 3, reps: "8" }] };
    expect(readDayResult({ ...day1, kept: "back focus" }, "Day 1")?.kept).toBe("back focus");
    expect(readDayResult(day1, "Day 1")).not.toHaveProperty("kept");
  });
  it("the retry is kept when it breaks fewer leave-outs, or the same and no more Spotter notes", () => {
    expect(takeRetry({ hard: 1, notes: 0 }, { hard: 0, notes: 1 })).toBe(true);
    expect(takeRetry({ hard: 0, notes: 1 }, { hard: 0, notes: 0 })).toBe(true);
    expect(takeRetry({ hard: 0, notes: 1 }, { hard: 0, notes: 1 })).toBe(true);
    expect(takeRetry({ hard: 0, notes: 1 }, { hard: 1, notes: 0 })).toBe(false);
    expect(takeRetry({ hard: 0, notes: 1 }, { hard: 0, notes: 2 })).toBe(false);
  });
  it("names read as a list", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("the day route runs it", () => {
  const route = read("app/api/ai/build-day/route.ts");
  it("reads the coach's Spotter answers on this program, and skips what the run already kept", () => {
    expect(route).toContain('supabase.from("programming_spotter_dismissals").select("check_kind, pattern_key").eq("program_id", programId)');
    expect(route).toContain("...keptKeys]);");
  });
  it("checks every draft (never a mobility day), folds the repair into the one retry, and keeps the better day", () => {
    expect(route).toContain('const mobilityDay = role === "must" || isMobilityTitle(parsed.title);');
    expect(route).toContain("repairNote(first.spotter)].filter(Boolean)");
    expect(route).toContain("if (retryNote && elapsed <= 28_000) {");
    expect(route).toContain("takeRetry({ hard: hard.length, notes: first.spotter.length }, { hard: second.scan.filter(isHard).length, notes: second.spotter.length })");
    expect(route.match(/await attempt\(/g)).toHaveLength(3);
  });
  it("sends back one line per note left, with its key", () => {
    expect(route).toContain("kept: first.spotter.map((n) => ({ key: n.key, line: keptLine(n, { week, day }, result.kept ?? null), onPurpose: !!result.kept })),");
  });
});

describe("the chat says it, and the Spotter's notes live in the chat on a program made there", () => {
  const chat = read("components/coach/desktop/program-builder-chat.tsx");
  const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
  const data = read("lib/program-builder-data.ts");
  const panel = read("components/coach/desktop/programming-spotter-panel.tsx");
  it("the run sends what it kept, says each kept note once, at most 3 lines when it stops, and reads the notes again", () => {
    expect(chat).toContain("keptKeys: keptKeys.current }),");
    expect(chat).toContain("if (k.onPurpose === true && !keptKeys.current.includes(k.key)) keptKeys.current = [...keptKeys.current, k.key];");
    expect(chat).toContain("if (saidKeys.current.includes(k.key)) continue;");
    expect(chat).toContain("const lines = keptLines.current.slice(0, MAX_KEPT_LINES);");
    expect(chat).toContain('if (lines.length > 0) say(lines.join("\\n"));');
    expect(chat).toContain("      sayKept();\n    }");
    expect(chat).toContain("router.refresh();");
    expect(MAX_KEPT_LINES).toBe(3);
  });
  it("a program with a builder conversation shows the notes at the end of the chat, not as the panel", () => {
    expect(data).toContain('supabase.from("coach_chat_threads").select("id").eq("coach_id", coachId).eq("program_id", programId).limit(1).maybeSingle(),');
    expect(data).toContain("notesInChat: !!chatThread,");
    expect(page).toContain("{!data.loadFailed && !data.notesInChat && <ProgrammingSpotterPanel programId={programId} flags={data.spotterFlags} />}");
    expect(page).toContain("spotterNotes={data.notesInChat ? data.spotterFlags : null}");
    expect(chat).toContain('<ProgrammingSpotterPanel programId={programId} flags={spotterNotes} variant="chat" />');
  });
  it("Confirm, Edit and Deny are the panel's own, in both places", () => {
    expect(panel).toContain('variant = "panel"');
    for (const label of ["Confirm", "Edit", "Deny", "Clear all"]) expect(panel).toContain(label);
    expect(panel).toContain("/api/programming-spotter/feedback");
  });
  it("coach-only words: nothing here names the AI", () => {
    const route = read("app/api/ai/build-day/route.ts");
    const lines = route.slice(route.indexOf("kept: first.spotter"), route.indexOf("runToken: issueRunToken"));
    expect(lines).not.toMatch(/\bAI\b|Claude|Spotter|suggested/);
    expect(keptLine({ key: "k", names: ["A", "B", "C"], problem: "A, B and C stacked" }, { week: 1, day: 1 }, null)).not.toMatch(/\bAI\b|Claude|Spotter|suggested/);
  });
});
