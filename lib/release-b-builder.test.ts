import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstSetFollowers } from "@/lib/first-set-fanout";
import { restoreDay } from "@/lib/program-restore";
import { resolveSessionsForDate, ASSIGNED_HEADING, type AssignedWorkout } from "@/lib/program-day-contexts";
import { showUndo, clearUndo, subscribeUndo, type UndoOffer } from "@/lib/undo-toast";
import type { BuilderDay } from "@/lib/types";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("quick edits no longer overwrite each other", () => {
  it("every change to a day's items, a week's days and an exercise's sets is built from the current list, not the one last drawn", () => {
    const day = src("components/coach/desktop/day-card.tsx");
    expect(day).not.toMatch(/onItemsChange\(\s*day\.items/);
    expect(day).not.toMatch(/onItemsChange\(\[\.\.\.day\.items/);
    const week = src("components/coach/desktop/week-grid.tsx");
    expect(week).toContain("onDaysChange((prev) => prev.map((d) => (d.id === day.id ? { ...d, ...patch } : d)))");
    expect(week).toContain('typeof items === "function" ? items(d.items) : items');
    expect(src("components/coach/desktop/program-builder-desktop.tsx")).toContain('typeof change === "function" ? change(week) : change');
    const card = src("components/coach/exercise-builder-card.tsx");
    expect(card).not.toMatch(/onSetsChange\(\s*exercise\.sets/);
    expect(card).not.toMatch(/onSetsChange\(\[\.\.\.exercise\.sets/);
  });
});

describe("the first set only fills the sets that are empty or still hold its old value", () => {
  const sets = [
    { id: "a", targetReps: 5 as number | null },
    { id: "b", targetReps: null },
    { id: "c", targetReps: 5 },
    { id: "d", targetReps: 3 }, // the coach's own number
  ];
  it("follows empty and equal sets, leaves the one with its own value", () => {
    expect(firstSetFollowers(sets, "a", ["targetReps"])).toEqual(["b", "c"]);
  });
});

describe("rest, pace and rep range are loaded into the builder", () => {
  it("both loaders read the full set of prescribed fields", () => {
    expect(src("lib/program-builder-data.ts")).not.toContain("target_distance )");
    expect(src("lib/program-builder-data.ts")).toContain("group_workout_exercise_sets ( ${SET_ROW_SELECT} )");
    expect(src("lib/workout-overview-data.ts")).toContain("group_workout_exercise_sets ( ${SET_ROW_SELECT} )");
  });
});

describe("empty days are offered for removal, never swept behind the coach's back", () => {
  it("the builder no longer sweeps on open; the button asks first", () => {
    const b = src("components/coach/desktop/program-builder-desktop.tsx");
    expect(b).not.toContain("initialDays.filter((d) => d.items.length === 0");
    expect(b).toContain("explicit: true");
    expect(b).toContain("Remove ${n} empty ${n === 1");
  });
});

describe("dragging and moving", () => {
  it("an exercise drag does not start a day drag, drops need a drag in progress, positions use the order shown, and move buttons show at every width", () => {
    const day = src("components/coach/desktop/day-card.tsx");
    expect(day).toContain("e.stopPropagation();");
    expect(day).toContain("const items = day.items.slice().sort((a, b) => a.order - b.order);");
    const week = src("components/coach/desktop/week-grid.tsx");
    expect(week).toContain("if (e.target !== e.currentTarget) return;");
    expect(week).toContain("const shown = days.slice().sort((a, b) => a.dayIndex - b.dayIndex);");
    expect(week).toContain("onMoveEarlier=");
    expect(src("components/coach/exercise-builder-card.tsx")).not.toContain("shrink-0 sm:hidden\" aria-label=\"Reorder exercise\"");
    expect(src("components/coach/text-note-card.tsx")).not.toContain("sm:hidden\" aria-label=\"Reorder note\"");
  });
  it("a note keeps its words in the day after saving, and a failed save says so", () => {
    const note = src("components/coach/text-note-card.tsx");
    expect(note).toContain("onBodyChange?.(nextBody);");
    expect(note).toContain("if (body !== lastSaved.current) persist(body);");
    expect(note).toContain("Couldn't save that note");
  });
});

describe("undo after a delete", () => {
  it("offers one Undo at a time and clears it", () => {
    const seen: Array<UndoOffer | null> = [];
    const off = subscribeUndo((o) => seen.push(o));
    showUndo({ message: "Deleted X.", onUndo: () => {} });
    clearUndo();
    off();
    expect(seen.map((o) => o?.message ?? null)).toEqual([null, "Deleted X.", null]);
  });
  it("exercise, note, day and week deletes each offer it", () => {
    expect(src("components/coach/exercise-builder-card.tsx")).toContain("showUndo({");
    expect(src("components/coach/text-note-card.tsx")).toContain("showUndo({");
    expect(src("components/coach/desktop/day-card.tsx")).toContain("showUndo({");
    expect(src("components/coach/desktop/week-grid.tsx")).toContain("showUndo({");
    expect(src("components/coach/desktop/program-builder-desktop.tsx")).toContain("<UndoToast />");
  });
  it("a day that cannot be fully put back is removed again, never left half there", async () => {
    const deleted: string[] = [];
    const inserted: string[] = [];
    const fake: any = {
      from: (table: string) => ({
        insert: (row: any) => {
          inserted.push(table);
          const fail = table === "group_workout_exercises";
          const res = { data: fail ? null : [], error: fail ? { message: "x" } : null };
          const p: any = Promise.resolve(res);
          p.select = () => Promise.resolve(res);
          return p;
        },
        delete: () => ({ eq: (_c: string, id: string) => { deleted.push(`${table}:${id}`); return Promise.resolve({ error: null }); } }),
      }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u" } } }) },
    };
    const day: BuilderDay = {
      id: "d1",
      title: "Day 1",
      weekNumber: 1,
      dayIndex: 1,
      scheduledDate: null,
      items: [{ kind: "exercise", id: "e1", order: 0, exerciseName: "Squat", displayName: null, movementPatternId: null, trackedFields: [], notes: null, videoPath: null, youtubeUrl: null, sets: [], tier: null }],
    };
    expect(await restoreDay(fake, { programId: "p", groupId: "g", day })).toBeNull();
    expect(deleted).toContain("workouts:d1");
  });
});

describe("undo brings back what the delete also took", () => {
  it("reads the clients' scheduled copies, session links and overrides before deleting, and puts them back with the day or exercise", () => {
    expect(src("components/coach/desktop/day-card.tsx")).toContain("snapshotDays(supabase, [day.id])");
    expect(src("components/coach/desktop/week-grid.tsx")).toContain("snapshotDays(supabase, days.map((d) => d.id))");
    expect(src("components/coach/exercise-builder-card.tsx")).toContain("snapshotExerciseOverrides(supabase, exercise.id)");
    const r = src("lib/program-restore.ts");
    expect(r).toContain("workout_assignments");
    expect(r).toContain("athlete_exercise_overrides");
    expect(src("components/coach/desktop/day-card.tsx")).toContain("Workouts you scheduled on this day for clients are removed too.");
  });
  it("a day whose scheduled copies cannot be put back is removed again, not reported as restored", async () => {
    const deleted: string[] = [];
    const fake: any = {
      from: (table: string) => ({
        insert: () => {
          const bad = table === "workout_assignments";
          const res = { data: [], error: bad ? { message: "x" } : null };
          const p: any = Promise.resolve(res);
          p.select = () => Promise.resolve(res);
          return p;
        },
        delete: () => ({
          eq: (_c: string, id: string) => {
            deleted.push(table + ":" + id);
            return Promise.resolve({ error: null });
          },
        }),
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
      }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u" } } }) },
    };
    const day: BuilderDay = { id: "d2", title: "Day 2", weekNumber: 1, dayIndex: 2, scheduledDate: null, items: [] };
    const snapshot = { note: "Day note", assignments: [{ athlete_id: "a", workout_id: "d2", scheduled_date: "2026-10-20" }], sessionIds: [], logIds: [] };
    expect(await restoreDay(fake, { programId: "p", groupId: "g", day, snapshot })).toBeNull();
    expect(deleted).toContain("workouts:d2");
  });
});

describe("a workout the coach put on one day shows on the client's Home with the note", () => {
  const assigned = new Map<string, AssignedWorkout>([["2026-10-20", { workoutId: "w9", title: "Test day", note: "Warm up long" }]]);
  const day = new Date(2026, 9, 20);
  const today = new Date(2026, 9, 16);
  it("replaces what the programs give that day, carries the note, and turns done once logged", () => {
    const planned = resolveSessionsForDate([], new Set(), day, today, false, assigned);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ status: "planned", workoutId: "w9", heading: ASSIGNED_HEADING, note: "Warm up long" });
    expect(resolveSessionsForDate([], new Set(["w9"]), day, today, false, assigned)[0].status).toBe("done");
    expect(resolveSessionsForDate([], new Set(), day, new Date(2026, 9, 25), false, assigned)[0].status).toBe("missed");
    expect(resolveSessionsForDate([], new Set(), new Date(2026, 9, 21), today, false, assigned)).toEqual([]);
  });
  it("Home loads the assignments and passes them to the day and the week and month cells", () => {
    const page = src("app/(coach)/groups/[groupId]/page.tsx");
    expect(page).toContain("loadAssignedWorkouts(supabase, athleteId, params.groupId");
    expect(page).toContain("resolveSessionsForDate(programContexts, loggedIds, targetDate, today, isToday, assignedByDate)");
    expect(page).toContain("resolveSessionsForDate(programContexts, loggedIds, date, today, false, assignedByDate)");
    expect(src("components/athlete/day-card.tsx")).toContain("{x.note &&");
  });
});
