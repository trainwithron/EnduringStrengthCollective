import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A workout started by mistake can be deleted from the same choice as Complete / Pause / Keep going.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const complete = read("components/session/complete-workout-button.tsx");

describe("Delete workout", () => {
  it("a quieter fourth button in the choice, after Keep going", () => {
    const choice = complete.slice(complete.indexOf("{confirming && !deleteAsked && ("), complete.indexOf("{error && ("));
    expect(choice.indexOf("Keep going")).toBeLessThan(choice.indexOf("Delete workout"));
    expect(choice).toContain('className="h-11 px-1 font-body text-xs text-steel underline underline-offset-2 sm:ml-auto"');
    expect(choice).toContain("setDeleteAsked(true)");
  });
  it("asks once: Delete this workout? Nothing is saved and no session is used. (Delete / Cancel)", () => {
    const ask = complete.slice(complete.indexOf("{confirming && deleteAsked && ("), complete.indexOf("{confirming && !deleteAsked && ("));
    expect(ask).toContain("Delete this workout? Nothing is saved and no session is used.");
    expect(ask).toContain('{submitting ? "Deleting…" : "Delete"}');
    expect(ask).toContain("Cancel");
    expect(ask).toContain("onClick={() => setDeleteAsked(false)}");
  });
  it("deletes only this workout and only while it is still in progress, then leaves the way Pause does; nothing else is written (the booking is untouched)", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    expect(del).toContain('.from("athlete_sessions").delete().eq("id", sessionId).eq("status", "in_progress").select("id")');
    expect(del).toContain("router.push(pauseHref)");
    expect(del).not.toContain("bookings");
    expect(del).not.toContain("rpc(");
    expect(del).not.toContain(".update(");
    expect(del).not.toContain(".insert(");
    // the only write to a table is the one delete
    expect(del.match(/\.delete\(\)/g)?.length).toBe(1);
  });
  it("records (PRs) are only written at complete, so there are none to take back", () => {
    // complete_workout_session is the only function that inserts records (team_sheet_save goes through it in the same call), and clients cannot insert them.
    expect(read("supabase/migrations/0385_set_types_and_records.sql")).toContain("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)");
    expect(read("supabase/migrations/0419_team_sheet_save.sql")).toContain("from public.complete_workout_session(v_session) x;");
    expect(complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"))).not.toContain("exercise_records");
  });
  it("a video recorded during the workout is removed from storage: paths read before the delete, files removed after it, a storage failure only logged", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    const readAt = del.indexOf('.from("session_exercise_videos").select("video_path").in("session_exercise_id", exerciseIds)');
    const deleteAt = del.indexOf('.from("athlete_sessions").delete()');
    const removeAt = del.indexOf('supabase.storage.from("athlete-exercise-videos").remove(videoPaths)');
    expect(readAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(deleteAt);
    expect(deleteAt).toBeLessThan(removeAt);
    expect(del).toContain('.from("session_exercises").select("id").eq("session_id", sessionId)');
    expect(del).toContain("if (storageError || (removed?.length ?? 0) < videoPaths.length) console.error(");
    // after a storage problem it still leaves (the workout is gone either way)
    expect(del.indexOf("router.push(pauseHref)")).toBeGreaterThan(removeAt);
  });
  it("a refused or failed delete says so and stays", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    expect(del).toContain("if (deleteError || !data || data.length === 0) {");
    expect(del).toContain("This workout couldn't be deleted. Nothing was changed.");
  });
});
