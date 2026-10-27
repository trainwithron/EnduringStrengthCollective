import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupIntoWeeks, importReadWarnings, parseImportRows, type ColumnMapping } from "@/lib/workout-import-parser";
import { resolveQuickAddExerciseName } from "@/lib/quick-add-name";
import { insertProgramDay, saveDayOrder } from "@/lib/program-days";
import { createGroupWithCoach } from "@/lib/create-group";
import { addLibraryExercise } from "@/lib/library-write";
import { moveProgression, renameProgramExercise } from "@/lib/rename-program-exercise";
import { editFailureMessage } from "@/lib/exercise-name-guard";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// columns: 0 week, 1 day, 2 exercise, 3 sets, 4 reps, 5 weight
const map = { week: 0, day: 1, exercise: 2, sets: 3, reps: 4, weight: 5 } as ColumnMapping;

describe("M1 weights are read only when they are plain numbers", () => {
  const w = (cell: string) => parseImportRows([["Week 1", "Day 1", "Squat", "3", "5", cell]], map)[0];
  it("plain numbers, with lb or kg after them, are weights (kg becomes pounds)", () => {
    expect(w("135").weight).toBe(135);
    expect(w("135 lb").weight).toBe(135);
    expect(w("135lbs").weight).toBe(135);
    expect(w("22.5").weight).toBe(22.5);
    expect(w("100 kg").weight).toBeCloseTo(220.5, 0);
  });
  it('"135-185", "BW+25" and "60%" are never turned into a wrong number: weight is blank and the text is kept', () => {
    for (const text of ["135-185", "BW+25", "60%", "bodyweight"]) {
      const row = w(text);
      expect(row.weight).toBeNull();
      expect(row.weightNote).toBe(text);
    }
    expect(w("").weightNote).toBeUndefined();
  });
  it("the coach is told, and the text goes into the exercise's note", () => {
    const rows = parseImportRows([["Week 1", "Day 1", "Squat", "3", "5", "135-185"], ["Week 1", "Day 1", "Bench", "3", "5", "BW+25"]], map);
    expect(importReadWarnings(rows)[0]).toBe('2 weights could not be read as a plain number (for example "135-185"). They are in the exercise notes and the weight is left blank.');
    const ex = groupIntoWeeks(rows)[0].days[0].exercises;
    expect(ex[0].note).toBe("Weight: 135-185");
    expect(src("lib/write-imported-program.ts")).toContain("...(ex.note ? { notes: ex.note } : {})");
  });
});

describe("M2 a blank Day or Week cell means the row above", () => {
  it("carries the previous label down instead of going back to Day 1 / Week 1", () => {
    const rows = parseImportRows(
      [
        ["Week 1", "Day 2", "Squat", "3", "5", ""],
        ["", "", "Bench", "3", "5", ""],
        ["", "Day 3", "Row", "3", "5", ""],
        ["Week 2", "Day 1", "Deadlift", "3", "5", ""],
        ["", "", "Press", "3", "5", ""],
      ],
      map
    );
    expect(rows.map((r) => `${r.week}/${r.day}`)).toEqual(["Week 1/Day 2", "Week 1/Day 2", "Week 1/Day 3", "Week 2/Day 1", "Week 2/Day 1"]);
  });
  it("a file with no Week or Day columns at all is still Week 1, Day 1", () => {
    const rows = parseImportRows([["", "", "Squat", "3", "5", ""]], map);
    expect(rows[0].week).toBe("Week 1");
    expect(rows[0].day).toBe("Day 1");
  });
});

describe("M3 week numbers", () => {
  const weeks = (labels: string[]) => groupIntoWeeks(labels.map((week) => ({ week, day: "Day 1", exerciseName: "Squat", sets: 3, reps: "5", weight: null, rpe: null, rest: null, timeSeconds: null }))).map((x) => x.weekNumber);
  it('takes the number after "week" or "wk", not the first digits', () => {
    expect(weeks(["Phase 1 Week 2"])).toEqual([2]);
    expect(weeks(["Wk 3", "Week 4", "5"])).toEqual([3, 4, 5]);
  });
  it("a missing or repeated number takes the next free one in the order the weeks appear", () => {
    expect(weeks(["Week 2", "Phase 1 Week 2", "Deload"])).toEqual([2, 1, 3]);
    expect(weeks(["Intro", "Build"])).toEqual([1, 2]);
  });
});

describe("M4 set count and a prescription in the exercise cell", () => {
  it("is cut to 20 and flagged above it", () => {
    const rows = parseImportRows([["Week 1", "Day 1", "Squat", "99", "5", ""]], map);
    expect(rows[0].sets).toBe(20);
    expect(importReadWarnings(rows)[0]).toBe("1 exercise had more than 20 sets; it was cut to 20. Check it.");
    expect(parseImportRows([["Week 1", "Day 1", "Squat", "20", "5", ""]], map)[0].setsCapped).toBeUndefined();
  });
  it('"Bench 3x10" in the exercise cell becomes the name Bench with 3 sets of 10', () => {
    const r = parseImportRows([["Week 1", "Day 1", "Bench 3x10", "", "", ""]], map)[0];
    expect(r.exerciseName).toBe("Bench");
    expect(r.sets).toBe(3);
    expect(r.reps).toBe("10");
  });
  it("what the row says itself wins over the cell's prescription", () => {
    const r = parseImportRows([["Week 1", "Day 1", "Bench 3x10", "4", "6", ""]], map)[0];
    expect(r.exerciseName).toBe("Bench");
    expect(r.sets).toBe(4);
    expect(r.reps).toBe("6");
  });
});

describe("M5 progression rules and library writes in the program import", () => {
  const wizard = src("components/coach/desktop/import-wizard.tsx");
  it("a rule is filed under the exercise's saved name, and failed writes are reported", () => {
    const writer = src("lib/write-imported-program.ts");
    expect(writer).toContain("input.resolutions.get(normalizeName(rule.exerciseName))?.exerciseName ?? rule.exerciseName");
    expect(writer).toContain("The progression rules did not save");
    expect(wizard).toContain("libraryFailures++");
    expect(wizard).toContain("summary.notices.map");
  });
});

describe("M6 and M7 renaming an exercise on a program day", () => {
  function fakeDb(state: { stillUsed: boolean; alreadyHasRule: boolean; updates: any[]; renames: any[] }) {
    return {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          limit: () => Promise.resolve({ data: table === "group_workout_exercises" ? (state.stillUsed ? [{ id: "x" }] : []) : state.alreadyHasRule ? [{ id: "r" }] : [] }),
          maybeSingle: () => Promise.resolve({ data: { program_id: "p1" } }),
          update: (patch: any) => {
            (table === "exercise_progressions" ? state.updates : state.renames).push({ table, patch });
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (r: any) => Promise.resolve({ error: null }).then(r) }) };
          },
        };
        return chain;
      },
    } as any;
  }
  it("the program's progression rule follows the exercise when nothing else uses the old name", async () => {
    const state = { stillUsed: false, alreadyHasRule: false, updates: [] as any[], renames: [] as any[] };
    const r = await renameProgramExercise(fakeDb(state), { exerciseId: "e", workoutId: "w", oldName: "Bench", newName: "Bench Press", displayName: null });
    expect(r.error).toBeNull();
    expect(state.renames[0].patch).toEqual({ exercise_name: "Bench Press", display_name: null });
    expect(state.updates[0].patch).toEqual({ exercise_name: "Bench Press" });
  });
  it("the rule stays when another day still uses the old name, or the new name already has one", async () => {
    const used = { stillUsed: true, alreadyHasRule: false, updates: [] as any[], renames: [] as any[] };
    await moveProgression(fakeDb(used), { workoutId: "w", oldName: "Bench", newName: "Bench Press" });
    expect(used.updates).toHaveLength(0);
    const has = { stillUsed: false, alreadyHasRule: true, updates: [] as any[], renames: [] as any[] };
    await moveProgression(fakeDb(has), { workoutId: "w", oldName: "Bench", newName: "Bench Press" });
    expect(has.updates).toHaveLength(0);
  });
  it("a bad name is refused before anything is written, and the recap screen uses the same rename", async () => {
    const state = { stillUsed: false, alreadyHasRule: false, updates: [] as any[], renames: [] as any[] };
    const r = await renameProgramExercise(fakeDb(state), { exerciseId: "e", workoutId: "w", oldName: "Bench", newName: "8,8,8" });
    expect(r.error).toBe("A name made only of numbers can't be added to your library.");
    expect(state.renames).toHaveLength(0);
    expect(src("components/coach/desktop/recap-and-up-next.tsx")).toContain("renameProgramExercise(supabase");
    expect(src("components/coach/exercise-builder-card.tsx")).toContain("renameProgramExercise(supabase");
  });
});

describe("M8 Quick add", () => {
  const lib = ["Sumo Squat", "Sumo Deadlift", "Bench Press", "Back Squat"];
  it("one library exercise starting with what was typed is used; several are asked about, nothing half-typed is saved", () => {
    expect(resolveQuickAddExerciseName("Bench", lib)).toEqual({ name: "Bench Press" });
    expect(resolveQuickAddExerciseName("Sumo S", lib)).toEqual({ name: "Sumo Squat" });
    expect(resolveQuickAddExerciseName("Sumo", lib)).toEqual({ ambiguous: ["Sumo Squat", "Sumo Deadlift"] });
    expect(resolveQuickAddExerciseName("Pistol Squat", lib)).toEqual({ name: "Pistol Squat" });
  });
  it('"10 3x8" is not an exercise named 10, and a name carrying sets and reps never reaches the library list', () => {
    const card = src("components/coach/desktop/day-card.tsx");
    expect(card).toContain("Type a little more of the name.");
    expect(card).toContain("exerciseNameProblem(parsed.exerciseName)");
    expect(resolveQuickAddExerciseName("Back", ["Back Squat", "Sumo Squat 3x10"])).toEqual({ name: "Back Squat" });
  });
});

describe("M9 the logger's add-exercise and the quick add by saying it never fail silently", () => {
  it("say so when an insert fails, match the library spelling, and keep what failed visible", () => {
    const logger = src("components/logging/session-logger.tsx");
    expect(logger).toContain("Couldn't add that exercise. Try again.");
    expect(logger).toContain("existingLibraryName(typed");
    const nl = src("components/logging/quick-add-nl-button.tsx");
    // the insert now lives in lib/add-session-exercises.ts, shared with the wing-it logger
    expect(nl).toContain("failedLine(failedExercises, draft.length)");
    const add = src("lib/add-session-exercises.ts");
    expect(add).toContain("did not save. Check the list above and add what is missing.");
    expect(add).toContain("setsError");
  });
});

describe("M10 one way into the library", () => {
  function fakeInsert(result: { error: { message: string } | null }) {
    const inserted: any[] = [];
    const db: any = {
      from: () => ({
        insert: (row: any) => {
          inserted.push(row);
          const p: any = Promise.resolve({ data: null, error: result.error });
          p.select = () => ({ single: () => Promise.resolve({ data: { id: "1", ...row }, error: result.error }) });
          return p;
        },
      }),
    };
    return { db, inserted };
  }
  it("checks the name, points to an existing spelling, and reports a failed write", async () => {
    const ok = fakeInsert({ error: null });
    expect(await addLibraryExercise(ok.db, { userId: "u", name: "  Hex  Bar Deadlift ", existingNames: [] })).toMatchObject({ ok: true, name: "Hex Bar Deadlift", alreadyThere: false });
    expect(ok.inserted[0]).toMatchObject({ created_by: "u", name: "Hex Bar Deadlift" });
    const dup = fakeInsert({ error: null });
    expect(await addLibraryExercise(dup.db, { userId: "u", name: "deadlifts", existingNames: ["Deadlift"] })).toMatchObject({ ok: true, name: "Deadlift", alreadyThere: true });
    expect(dup.inserted).toHaveLength(0);
    const bad = fakeInsert({ error: null });
    expect(await addLibraryExercise(bad.db, { userId: "u", name: "Sumo Squat 3x10", existingNames: [] })).toEqual({ ok: false, error: "That looks like sets and reps, not an exercise name." });
    expect(await addLibraryExercise(bad.db, { userId: "u", name: "ab", existingNames: [] })).toEqual({ ok: false, error: "That name is too short to add to your library." });
    expect(bad.inserted).toHaveLength(0);
    const fail = fakeInsert({ error: { message: "boom" } });
    expect(await addLibraryExercise(fail.db, { userId: "u", name: "Hex Bar Deadlift", existingNames: [] })).toEqual({ ok: false, error: "Couldn't add that to your library. Try again." });
  });
  it("an edit the database refused says why only when its own name rule refused it; auto-categorize no longer paints categories that did not save", () => {
    expect(editFailureMessage(null)).toBeNull();
    expect(editFailureMessage({ message: 'violates check constraint "exercise_library_name_not_digits"' })).toContain("named with only numbers or with sets and reps");
    expect(editFailureMessage({ message: "network down" })).toBe("That change didn't save. Try again.");
    const auto = src("components/coach/auto-categorize-button.tsx");
    expect(auto).toContain("if (error) failed += ids.length;");
    expect(auto).toContain("else for (const id of ids) onApplied(id, category);");
  });
});

describe("M11 and M12 creating a group", () => {
  function fakeGroups(seatFails: boolean) {
    const calls: string[] = [];
    const db: any = {
      from: (table: string) => ({
        insert: (row: any) => {
          calls.push(`insert ${table}`);
          return Promise.resolve({ error: table === "group_memberships" && seatFails ? { message: "no" } : null });
        },
      }),
    };
    return { db, calls };
  }
  it("the creator is seated as coach; if the seat cannot be made the group is taken back through the server (a signed-in person cannot delete a group)", async () => {
    const discarded: string[] = [];
    const discard = async (id: string) => (discarded.push(id), true);
    const good = fakeGroups(false);
    const made = await createGroupWithCoach(good.db, { userId: "u", name: "Team", organizationId: "o", kind: "team", discard });
    expect(made.id).toBeTruthy();
    expect(good.calls).toEqual(["insert groups", "insert group_memberships"]);
    expect(discarded).toEqual([]);
    const bad = fakeGroups(true);
    const failed = await createGroupWithCoach(bad.db, { userId: "u", name: "Team", organizationId: "o", kind: "team", discard });
    expect(failed).toEqual({ id: null, error: "Couldn't create the group. Try again." });
    expect(bad.calls).toEqual(["insert groups", "insert group_memberships"]); // no direct delete from the browser
    expect(discarded).toHaveLength(1);
  });
  it("closing the add-client box before anyone was added removes the empty space (never one that has a client)", () => {
    const add = src("components/coach/desktop/add-client-button.tsx");
    expect(add).toContain("if (createdGroupIdRef.current && !added && !invitedExisting) void removeEmptySpace(createdGroupIdRef.current);");
    expect(add).toContain("await discardEmptyGroup(groupIdToCheck)");
    expect(add).not.toContain('.from("groups").delete()');
  });
});

describe("M13 a visitor booking is filed in the organization of the session type", () => {
  it("is passed from the session type to the store, which uses it when the coach belongs to it", () => {
    expect(src("lib/public-booking-engine.ts")).toContain("type.organizationId ?? null");
    const store = src("lib/public-booking-store.ts");
    expect(store).toContain('query.eq("organization_id", organizationId)');
    expect(store).toContain("organization_id");
  });
});

describe("M14 the AI day is written all or nothing, and paid for after it is written", () => {
  const route = src("app/api/ai/build-day/route.ts");
  it("any failed write removes what the try wrote and keeps the old day; the credit is spent only after the whole day is in", () => {
    expect(route).toContain("if (failed > 0) {");
    expect(route.indexOf("if (failed > 0) {")).toBeLessThan(route.indexOf('checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation")'));
    expect(route.indexOf('checkAndSpendCoachCredits(createServiceRoleClient(), user.id, "program_generation")')).toBeLessThan(route.indexOf('delete().in("id", oldIds)'));
    expect(route).toContain("await undoWrite();");
    expect(route).toContain("madeWorkout");
  });
});

describe("M15 day numbers", () => {
  function fakeWorkouts(existing: number[], conflictsFirst: number) {
    let inserts = 0;
    const inserted: any[] = [];
    const db: any = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          order: () => q,
          limit: () => Promise.resolve({ data: existing.length ? [{ day_index: Math.max(...existing), week_number: Math.max(...existing) }] : [] }),
          insert: (row: any) => {
            inserts++;
            inserted.push(row);
            const fail = inserts <= conflictsFirst;
            if (!fail) existing.push(row.day_index);
            else existing.push(row.day_index); // someone else took it
            return { select: () => ({ single: () => Promise.resolve(fail ? { data: null, error: { code: "23505" } } : { data: { id: "n", title: row.title, week_number: row.week_number, day_index: row.day_index }, error: null }) }) };
          },
        };
        return q;
      },
    };
    return { db, inserted };
  }
  it("takes the next free number from what is saved, and retries when it loses a race", async () => {
    const calm = fakeWorkouts([1, 2], 0);
    const r = await insertProgramDay(calm.db, { programId: "p", groupId: "g", weekNumber: 1, title: (n) => `Day ${n}` });
    expect(r.row?.day_index).toBe(3);
    const racy = fakeWorkouts([1, 2], 1);
    const r2 = await insertProgramDay(racy.db, { programId: "p", groupId: "g", weekNumber: 1, title: (n) => `Day ${n}` });
    expect(r2.row?.day_index).toBe(4);
    expect(racy.inserted.map((x) => x.day_index)).toEqual([3, 4]);
    const stuck = fakeWorkouts([1], 99);
    const r3 = await insertProgramDay(stuck.db, { programId: "p", groupId: "g", weekNumber: 1, title: (n) => `Day ${n}` });
    expect(r3.row).toBeNull();
    expect(r3.error).toContain("Try again");
  });
  it("reordering days never gives two days the same number at any moment", async () => {
    const seen: { id: string; day_index: number }[][] = [];
    const db: any = {
      from: () => ({
        update: (patch: any) => ({
          eq: (_c: string, id: string) => {
            const last = seen[seen.length - 1] ?? [];
            seen.push([...last.filter((x) => x.id !== id), { id, day_index: patch.day_index }]);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    expect(await saveDayOrder(db, ["a", "b", "c"])).toBe(true);
    for (const state of seen) {
      const nums = state.map((x) => x.day_index);
      expect(new Set(nums).size).toBe(nums.length);
    }
    expect(seen[seen.length - 1].map((x) => x.day_index).sort()).toEqual([1, 2, 3]);
  });
  it("the migration is a unique rule and the screens use the helper", () => {
    expect(src("supabase/migrations/0380_program_day_numbers_unique.sql")).toContain("unique (program_id, week_number, day_index)");
    expect(src("components/coach/desktop/week-grid.tsx")).toContain("insertProgramDay(supabase");
    expect(src("components/coach/desktop/week-grid.tsx")).toContain("saveDayOrder(supabase");
    expect(src("components/coach/desktop/program-builder-desktop.tsx")).toContain('weekNumber: "next"');
  });
});

describe("M16 duplicate with progression", () => {
  const panel = src("components/coach/desktop/duplicate-week-panel.tsx");
  it("a slot's sets keep every column, and a failure removes everything the run made", () => {
    for (const col of ["target_distance: st.targetDistance", "target_pace: st.targetPace", "rep_min: st.repMin", "rep_max: st.repMax", "target_rest_max_seconds: st.targetRestMaxSeconds"]) expect(panel).toContain(col);
    expect(panel).toContain('await supabase.from("workouts").delete().in("id", createdDayIds)');
    expect(panel).toContain("Couldn't add those weeks, so nothing was added. Try again.");
    expect(panel.indexOf("if (anyFailed) {")).toBeLessThan(panel.indexOf("onGenerated(generatedDays);"));
  });
});

describe("M17 and L5", () => {
  it("a one-on-one space's name follows its client (a database trigger, the same everywhere it is shown)", () => {
    const sql = src("supabase/migrations/0381_one_on_one_group_name_follows_client.sql");
    expect(sql).toContain("after update of full_name on public.profiles");
    expect(sql).toContain("lower(btrim(g.name)) = lower(btrim(old.full_name))");
  });
  it("a new claim link is made before the old ones are retired", () => {
    const s = src("lib/client-claim-server.ts");
    expect(s.indexOf('.from("client_invites")\n    .insert(')).toBeLessThan(s.indexOf("used_at: retiredAt"));
    expect(s).toContain('.neq("id", made.id)');
  });
});
