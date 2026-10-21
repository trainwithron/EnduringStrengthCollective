import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanExerciseName, exerciseNameProblem } from "@/lib/exercise-name-guard";
import { importHistoryRows, insertManualHistoryEntry } from "@/lib/exercise-history-import";
import { runFitprosImport } from "@/lib/fitpros-history-import";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the one name check every writer uses", () => {
  it("tidies spaces and refuses empty, numbers-only and sets-and-reps names with plain messages", () => {
    expect(cleanExerciseName("  Back   Squat ")).toBe("Back Squat");
    expect(exerciseNameProblem("Back Squat")).toBeNull();
    expect(exerciseNameProblem("5/3/1")).toBeNull();
    expect(exerciseNameProblem("   ")).toBe("Give the exercise a name.");
    expect(exerciseNameProblem("10,10,10")).toBe("A name made only of numbers can't be added to your library.");
    expect(exerciseNameProblem("Sumo Squat 3x10")).toBe("That looks like sets and reps, not an exercise name.");
    expect(exerciseNameProblem("10")).not.toBeNull(); // "10 3x8" must not become an exercise named 10
  });
  it("is used by every place that writes an exercise name", () => {
    for (const p of [
      "lib/fitpros-history-import.ts",
      "lib/exercise-history-import.ts",
      "components/coach/desktop/day-card.tsx",
      "lib/rename-program-exercise.ts",
      "components/logging/session-logger.tsx",
      "components/logging/quick-add-nl-button.tsx",
      "components/coach/exercise-builder-card.tsx",
    ]) {
      expect(src(p), p).toMatch(/exerciseNameProblem|splitPrescriptionName|isBadExerciseName/);
    }
    const wizard = src("components/coach/desktop/import-wizard.tsx");
    expect(wizard).toContain("isPrescriptionName(n)");
    expect(wizard).toContain("isBadExerciseName(name)");
  });
});

// A recording stand-in for the database: each insert is answered by a rule the test gives.
function fakeDb(rules: { athlete_sessions?: (row: any, n: number) => boolean; session_exercises?: (row: any, n: number) => boolean; set_logs?: (row: any, n: number) => boolean }) {
  const inserts: { table: string; row: any }[] = [];
  const counts: Record<string, number> = {};
  const db: any = {
    from(table: string) {
      return {
        insert(row: any) {
          counts[table] = (counts[table] ?? 0) + 1;
          inserts.push({ table, row });
          const ok = (rules as any)[table] ? (rules as any)[table](row, counts[table]) : true;
          const result = ok ? { data: { id: `${table}-${counts[table]}` }, error: null } : { data: null, error: { message: "refused" } };
          const chain: any = { select: () => chain, single: () => Promise.resolve(result), then: (res: any) => Promise.resolve({ error: ok ? null : { message: "refused" } }).then(res) };
          return chain;
        },
      };
    },
  };
  return { db, inserts };
}
const row = (date: string, name: string, reps = 5) => ({ date, exerciseName: name, weight: 100, reps, rpe: null }) as any;

describe("importing history rows says what did not save", () => {
  it("everything saved: counts match and nothing failed", async () => {
    const { db } = fakeDb({});
    const r = await importHistoryRows(db, { athleteId: "a", groupId: "g", rows: [row("2026-01-01", "Squat"), row("2026-01-01", "Squat"), row("2026-01-02", "Bench")] });
    expect(r).toMatchObject({ importedCount: 3, totalRows: 3, failedRows: [], failedDates: [], error: null });
  });
  it("a day whose session could not be made is reported with its date and its rows, the other days still save", async () => {
    const { db } = fakeDb({ athlete_sessions: (_row, n) => n !== 1 });
    const r = await importHistoryRows(db, { athleteId: "a", groupId: "g", rows: [row("2026-01-01", "Squat"), row("2026-01-02", "Bench")] });
    expect(r.importedCount).toBe(1);
    expect(r.totalRows).toBe(2);
    expect(r.failedDates).toEqual(["2026-01-01"]);
    expect(r.failedRows.map((x) => x.exerciseName)).toEqual(["Squat"]);
  });
  it("a set that did not save is counted as failed with its date", async () => {
    const { db } = fakeDb({ set_logs: (_row, n) => n !== 2 });
    const r = await importHistoryRows(db, { athleteId: "a", groupId: "g", rows: [row("2026-01-01", "Squat", 5), row("2026-01-01", "Squat", 6), row("2026-01-01", "Squat", 7)] });
    expect(r.importedCount).toBe(2);
    expect(r.failedRows).toHaveLength(1);
    expect(r.failedRows[0].reps).toBe(6);
    expect(r.failedDates).toEqual(["2026-01-01"]);
  });
  it("a numbers-only or sets-and-reps name writes nothing at all and says why", async () => {
    const { db, inserts } = fakeDb({});
    const r = await importHistoryRows(db, { athleteId: "a", groupId: "g", rows: [row("2026-01-01", "Squat"), row("2026-01-01", "10,10,10")] });
    expect(inserts).toHaveLength(0);
    expect(r.importedCount).toBe(0);
    expect(r.error).toBe("A name made only of numbers can't be added to your library.");
    const manual = await insertManualHistoryEntry(db, { athleteId: "a", groupId: "g", exerciseName: "Sumo Squat 3x10", weight: 1, reps: 1, rpe: null, date: "2026-01-01" });
    expect(manual.error).toBe("That looks like sets and reps, not an exercise name.");
    expect(inserts).toHaveLength(0);
  });
  it("the uploader shows 'N of M saved' with the dates and keeps the file open on only those rows, and stops on a bad name before the review", () => {
    const up = src("components/coach/exercise-history-uploader.tsx");
    expect(up).toContain("of ${result.totalRows} saved. These dates did not save:");
    expect(up).toContain("setCsvRows(result.failedRows)");
    expect(up).toContain('setCsvStatus("reviewing")');
    expect(up).toContain("exerciseNameProblem(r.exerciseName)");
  });
});

describe("a FitPros import writes nothing for a day with a bad name", () => {
  it("reports the day and does not create its session", async () => {
    const { db, inserts } = fakeDb({});
    const plan: any[] = [{ date: "2026-01-05", programWorkoutId: null, exercises: [{ savedName: "8,8,8", programExerciseId: null, note: null, sets: [] }], durationSeconds: null }];
    const r = await runFitprosImport(db, { athleteId: "a", groupId: "g", plan, existingKeys: new Set() });
    expect(r.imported).toBe(0);
    expect(r.failed[0]).toContain("2026-01-05");
    expect(inserts.filter((i) => i.table === "athlete_sessions")).toHaveLength(0);
  });
  it("every session one run writes carries the same import batch, a new one each run, so the History list offers 'Undo this import' (Oct 21: FitPros sessions had none)", async () => {
    const { db, inserts } = fakeDb({});
    const plan: any[] = ["2026-01-05", "2026-01-07"].map((date) => ({ date, programWorkoutId: null, exercises: [], durationSeconds: null }));
    const first = await runFitprosImport(db, { athleteId: "a", groupId: "g", plan, existingKeys: new Set() });
    expect(first.imported).toBe(2);
    const firstRows = inserts.filter((i) => i.table === "athlete_sessions").map((i) => i.row);
    expect(firstRows.map((r) => r.import_batch_id)).toEqual([first.batchId, first.batchId]);
    expect(first.batchId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await runFitprosImport(db, { athleteId: "a", groupId: "g", plan: [{ ...plan[0], date: "2026-01-09" }], existingKeys: new Set() });
    expect(second.batchId).not.toBe(first.batchId);
    expect(inserts.filter((i) => i.table === "athlete_sessions").at(-1)!.row.import_batch_id).toBe(second.batchId);
  });
});

describe("moving a client", () => {
  it("a new one-on-one group takes the organization of the client's current group, not 'the coach's only organization'", () => {
    const c = src("components/coach/change-client-group-control.tsx");
    expect(c).toContain('.from("groups").select("organization_id").eq("id", currentGroupId)');
    expect(c).toContain('.eq("organization_id", current.organization_id)');
    expect(c).not.toMatch(/from\("organization_memberships"\)\s*\.select\("organization_id"\)\s*\.eq\("profile_id", user\.id\)\s*\.maybeSingle/);
  });
  it("the database function finds the tables itself (so a new table is covered) and keeps the old group's own structures", () => {
    const m = src("supabase/migrations/0378_move_client_moves_everything.sql");
    expect(m).toContain("from information_schema.columns c");
    expect(m).toContain("'group_session_attendees', 'package_group_access', 'kiosk_pins', 'kiosk_checkins', 'game_score_entries'");
    expect(m).toContain("update public.exercise_progressions set group_id");
    expect(m).toContain("update public.session_coach_notes set group_id");
    expect(m).toContain("Must coach both the source and destination group.");
  });
});
