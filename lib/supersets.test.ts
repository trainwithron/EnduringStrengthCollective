import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterSupersetSet, blockKind, canLinkWithNext, supersetLine, supersetPlaces } from "@/lib/supersets";
import { lastTimeLine } from "@/lib/superset-links";
import { mapSetRow, SET_ROW_SELECT } from "@/lib/exercise-fields";

// Builder wave 1 (Ron, Nov 20): B1 supersets and circuits, B2 the set types in the builder, B6 the client's last time on the builder card.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const ex = (id: string, supersetNext = false) => ({ id, kind: "exercise" as const, supersetNext });

describe("B1: linked exercises are numbered by block and lettered within it", () => {
  it("1, 2a, 2b, 3: a lone exercise is a block of its own and gets no label", () => {
    const places = supersetPlaces([ex("squat"), ex("bench", true), ex("row"), ex("curl")]);
    expect(places.get("squat")).toBeUndefined();
    expect(places.get("bench")).toMatchObject({ label: "2a", members: ["bench", "row"], index: 0 });
    expect(places.get("row")).toMatchObject({ label: "2b", index: 1 });
    expect(places.get("curl")).toBeUndefined();
  });
  it("three or more is a circuit; two blocks in a row are numbered apart", () => {
    const places = supersetPlaces([ex("a", true), ex("b", true), ex("c"), ex("d", true), ex("e")]);
    expect(["a", "b", "c"].map((id) => places.get(id)?.label)).toEqual(["1a", "1b", "1c"]);
    expect(["d", "e"].map((id) => places.get(id)?.label)).toEqual(["2a", "2b"]);
    expect(blockKind(3)).toBe("Circuit");
    expect(blockKind(2)).toBe("Superset");
  });
  it("a note between two exercises, or the end of the day, ends a link", () => {
    const places = supersetPlaces([ex("a", true), { id: "n", kind: "note" }, ex("b"), ex("c", true)]);
    expect(places.size).toBe(0);
    expect(canLinkWithNext([ex("a"), { id: "n", kind: "note" }, ex("b")], "a")).toBe(false);
    expect(canLinkWithNext([ex("a"), ex("b")], "a")).toBe(true);
    expect(canLinkWithNext([ex("a"), ex("b")], "b")).toBe(false);
  });
});

describe("B1: in the client's workout, one set of each, then rest", () => {
  it("after the first exercise's set the next one follows with no rest; after the last the rest comes and the round starts again", () => {
    expect(afterSupersetSet([{ id: "a", setsLeft: 2 }, { id: "b", setsLeft: 3 }], "a")).toEqual({ rest: false, nextId: "b" });
    expect(afterSupersetSet([{ id: "a", setsLeft: 2 }, { id: "b", setsLeft: 2 }], "b")).toEqual({ rest: true, nextId: "a" });
  });
  it("an exercise with no sets left is skipped; the last set of all rests and goes nowhere", () => {
    expect(afterSupersetSet([{ id: "a", setsLeft: 1 }, { id: "b", setsLeft: 0 }, { id: "c", setsLeft: 1 }], "a")).toEqual({ rest: false, nextId: "c" });
    expect(afterSupersetSet([{ id: "a", setsLeft: 1 }, { id: "b", setsLeft: 0 }], "b")).toEqual({ rest: true, nextId: "a" });
    expect(afterSupersetSet([{ id: "a", setsLeft: 0 }, { id: "b", setsLeft: 0 }], "b")).toEqual({ rest: true, nextId: null });
  });
  it("says what to do under the name", () => {
    expect(supersetLine(2, ["Row"])).toBe("Superset with Row: one set of each, then rest.");
    expect(supersetLine(3, ["Row", "Curl"])).toBe("Circuit with Row and Curl: one set of each in turn, then rest.");
  });
  it("the logger labels the cards, moves to the next exercise of the block, and holds the rest until the round is done", () => {
    const logger = read("components/logging/session-logger.tsx");
    expect(logger).toContain("const step = afterSupersetSet(members, owner.id);");
    expect(logger).toContain("if (!step.rest) return;");
    expect(logger).toContain("exercises={shownExercises}");
    const card = read("components/logging/exercise-card.tsx");
    expect(card).toContain("{exercise.superset.label}");
    expect(card).toContain("{exercise.superset.line}");
    // the link comes from the program's exercise, read on its own so the workout opens without it
    expect(read("app/sessions/[sessionId]/page.tsx")).toContain("supersetNext: !!se.group_workout_exercise_id && linkedTemplateIds.has(se.group_workout_exercise_id),");
  });
});

describe("B1: the builder", () => {
  it("a link button on each exercise that has one after it, and the block's label", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("{onToggleLink && (canLink || linkedToNext) && (");
    expect(card).toContain('aria-pressed={linkedToNext}');
    // in the row that wraps, never the header row (which is full on a 375px phone)
    expect(card).toContain('className={`min-h-11 sm:min-h-0 inline-flex items-center gap-1 font-body text-xs ${linkedToNext ? "text-rust" : "text-steel"}`}');
    expect(card).toContain("{supersetLabel}");
    const day = read("components/coach/desktop/day-card.tsx");
    expect(day).toContain('.update({ superset_next: next }).eq("id", item.id)');
    expect(day).toContain("const place = supersetPlaces(sortedItems).get(item.id) ?? null;");
  });
  it("links survive Duplicate week, Undo, and Assign / Duplicate / Make a template (duplicate_program, step 210)", () => {
    const week = read("components/coach/desktop/duplicate-week-panel.tsx");
    expect(week).toContain("...(first.supersetNext ? { superset_next: true } : {}),");
    expect(week).toContain("...(intervalTrack.supersetNext ? { superset_next: true } : {}),");
    expect(read("lib/program-restore.ts")).toContain("...(ex.supersetNext ? { superset_next: true } : {}),");
    const mig = read("supabase/migrations/0454_supersets_and_set_types.sql");
    expect(mig).toContain("alter table public.group_workout_exercises add column if not exists superset_next boolean not null default false;");
    expect(mig).toContain("'e.is_slot, e.slot_side, e.slot_tier, e.progression_slot, e.superset_next'");
  });
  it("the program opens without links when the column is not there yet", () => {
    const links = read("lib/superset-links.ts");
    expect(links).toContain('.eq("superset_next", true)');
    expect(links).toContain("if (error) return new Set();");
    expect(read("lib/program-builder-data.ts")).toContain("supersetNext: linkedIds.has(ex.id),");
  });
});

describe("B2: the coach chooses the kind of each set, and the client's workout starts with it", () => {
  it("the builder reads and maps it", () => {
    expect(SET_ROW_SELECT).toContain("set_type");
    expect(mapSetRow({ id: "s", set_order: 0, target_reps: "5", target_weight: null, target_rpe: null, target_rir: null, target_tempo: null, target_time_seconds: null, target_height: null, target_distance: null, set_type: "amrap" }).setType).toBe("amrap");
    expect(mapSetRow({ id: "s", set_order: 0, target_reps: null, target_weight: null, target_rpe: null, target_rir: null, target_tempo: null, target_time_seconds: null, target_height: null, target_distance: null }).setType).toBe("working");
  });
  it("a Type row on each exercise, saved at once", () => {
    const card = read("components/coach/exercise-builder-card.tsx");
    expect(card).toContain("data-set-type-row");
    expect(card).toContain('.from("group_workout_exercise_sets").update({ set_type: setType }).eq("id", setId)');
    // a new set and a duplicated exercise keep the kinds
    expect(card).toContain('set_type: last?.setType ?? "working",');
    expect(card).toContain('set_type: s.setType ?? "working",');
  });
  it("Duplicate week and Undo keep each set's kind", () => {
    const week = read("components/coach/desktop/duplicate-week-panel.tsx");
    expect((week.match(/set_type: track\.setType,/g) ?? []).length).toBe(2);
    expect(week).toContain('set_type: st.setType ?? "working",');
    expect(read("lib/program-restore.ts")).toContain('set_type: st.setType ?? "working",');
  });
  it("starting the workout sends each set's kind, and the database keeps it (step 210)", () => {
    expect(read("components/logging/start-workout-button.tsx")).toContain('set_type: target.setType ?? "working",');
    const mig = read("supabase/migrations/0454_supersets_and_set_types.sql");
    expect(mig).toContain("'insert into public.set_logs (session_exercise_id, set_order, weight, reps, set_type)'");
    expect(mig).toContain("then st ->> ''set_type'' else ''working'' end");
  });
  it("the client's workout shows an AMRAP, back-off or drop set under its number and keeps it as the coach set it", () => {
    const grid = read("components/logging/exercise-set-grid.tsx");
    expect(grid).toContain('const special = set.setType === "amrap" || set.setType === "backoff" || set.setType === "drop" ? set.setType : null;');
    expect(grid).toContain("if (readOnly || special) {");
  });
});

describe("B6: the client's last time on the builder card", () => {
  it("weight × reps", () => {
    expect(lastTimeLine({ weight: 135, reps: 8 })).toBe("Last time 135 × 8");
    expect(lastTimeLine({ weight: 102.5, reps: 5 })).toBe("Last time 102.5 × 5");
    expect(lastTimeLine(null)).toBeNull();
  });
  it("only on a client's own program, from the client's completed sets", () => {
    const data = read("lib/program-builder-data.ts");
    expect(data).toContain("program.athlete_id ? recentLastTimes(supabase, program.athlete_id as string)");
    const links = read("lib/superset-links.ts");
    expect(links).toContain('.eq("session_exercises.athlete_sessions.athlete_id", athleteId)');
    expect(links).toContain('.eq("status", "completed")');
    expect(read("components/coach/exercise-builder-card.tsx")).toContain("data-builder-last-time");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("<BuilderLastTimeProvider value={data.lastTimeByExercise}>");
  });
});
