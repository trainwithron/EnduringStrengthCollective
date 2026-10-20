import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deleteInProgressWorkout, ownVideoPaths } from "./delete-workout";

// A workout started by mistake can be deleted from the same choice as Complete / Pause / Keep going.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const complete = read("components/session/complete-workout-button.tsx");

const S = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const ATHLETE = "athlete-1";
const COACH = "coach-1";

// A tiny stand-in for the Supabase client: each table answers from `tables`, and every call is recorded.
function fakeClient(tables: Record<string, any[]>, log: string[], opts: { removed?: (paths: string[]) => string[] } = {}) {
  const from = (table: string) => {
    const filters: [string, string, unknown][] = [];
    let mode = "select";
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([op, k, v]) => (op === "in" ? (v as unknown[]).includes(r[k]) : r[k] === v)));
    const q: any = {
      select: () => q,
      delete: () => ((mode = "delete"), log.push(`delete ${table}`), q),
      eq: (k: string, v: unknown) => (filters.push(["eq", k, v]), q),
      in: (k: string, v: unknown[]) => (filters.push(["in", k, v]), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: any) => {
        const found = rows();
        if (mode === "delete") tables[table] = (tables[table] ?? []).filter((r) => !found.includes(r));
        else log.push(`read ${table}`);
        return resolve({ data: found, error: null });
      },
    };
    return q;
  };
  return {
    from,
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => (log.push(`remove ${bucket} ${paths.join(",")}`), { data: (opts.removed ?? ((p) => p))(paths).map((name) => ({ name })), error: null }) }) },
  };
}

function world(status = "in_progress") {
  return {
    athlete_sessions: [{ id: S, athlete_id: ATHLETE, group_id: G, status }],
    group_memberships: [{ id: "m1", group_id: G, profile_id: COACH, role: "coach" }],
    session_exercises: [{ id: "se1", session_id: S }, { id: "se2", session_id: S }, { id: "other", session_id: "someone-else" }],
    session_exercise_videos: [
      { session_exercise_id: "se1", video_path: `${G}/se1/a.mp4` },
      { session_exercise_id: "se2", video_path: `${G}/se2/coach-recorded.mov` },
      { session_exercise_id: "other", video_path: `${G}/other/not-this-workout.mp4` },
    ],
  };
}

describe("Delete workout: the choice", () => {
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
    expect(ask).toContain("onClick={() => setDeleteAsked(false)}");
  });
  it("sends only the session id to the server, then leaves the way Pause does; a refusal says so and stays", () => {
    const del = complete.slice(complete.indexOf("async function handleDelete()"), complete.indexOf("async function handleComplete()"));
    expect(del).toContain('fetch("/api/workout-session/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) })');
    expect(del).toContain("router.push(pauseHref)");
    expect(del).toContain("This workout couldn't be deleted. Nothing was changed.");
    expect(del).not.toContain(".from(");
  });
});

describe("Delete workout: the server", () => {
  it("the athlete deletes their own in-progress workout; only its own videos are removed, the coach's recording included", async () => {
    const t = world();
    const log: string[] = [];
    const db = fakeClient(t, log);
    const admin = fakeClient(t, log);
    const r = await deleteInProgressWorkout({ db, admin, userId: ATHLETE, sessionId: S });
    expect(r).toEqual({ status: 200, removedVideos: 2 });
    expect(t.athlete_sessions).toEqual([]);
    expect(log.at(-1)).toBe(`remove athlete-exercise-videos ${G}/se1/a.mp4,${G}/se2/coach-recorded.mov`);
    // read -> delete -> remove
    expect(log.indexOf("read session_exercise_videos")).toBeLessThan(log.indexOf("delete athlete_sessions"));
    expect(log.indexOf("delete athlete_sessions")).toBeLessThan(log.findIndex((l) => l.startsWith("remove")));
  });
  it("a coach of the group may delete it too", async () => {
    const t = world();
    const r = await deleteInProgressWorkout({ db: fakeClient(t, []), admin: fakeClient(t, []), userId: COACH, sessionId: S });
    expect(r.status).toBe(200);
  });
  it("a stranger is refused before anything is read with the service role or deleted", async () => {
    const t = world();
    const log: string[] = [];
    const r = await deleteInProgressWorkout({ db: fakeClient(t, log), admin: fakeClient(t, log), userId: "stranger", sessionId: S });
    expect(r.status).toBe(403);
    expect(t.athlete_sessions).toHaveLength(1);
    expect(log.some((l) => l.includes("session_exercise") || l.startsWith("delete") || l.startsWith("remove"))).toBe(false);
  });
  it("a workout the caller cannot see (row security) is not found; a finished one is never deleted; a bad id is refused", async () => {
    const hidden = world();
    hidden.athlete_sessions = [];
    expect((await deleteInProgressWorkout({ db: fakeClient(hidden, []), admin: fakeClient(world(), []), userId: ATHLETE, sessionId: S })).status).toBe(404);
    const done = world("completed");
    expect((await deleteInProgressWorkout({ db: fakeClient(done, []), admin: fakeClient(done, []), userId: ATHLETE, sessionId: S })).status).toBe(409);
    expect(done.athlete_sessions).toHaveLength(1);
    expect((await deleteInProgressWorkout({ db: fakeClient(world(), []), admin: fakeClient(world(), []), userId: ATHLETE, sessionId: "../x" })).status).toBe(400);
  });
  it("only paths in this workout's own folders are removed", () => {
    const ids = new Set(["se1"]);
    expect(
      ownVideoPaths(G, [
        { session_exercise_id: "se1", video_path: `${G}/se1/a.mp4` },
        { session_exercise_id: "se1", video_path: `other-group/se1/b.mp4` },
        { session_exercise_id: "se1", video_path: `${G}/se1/../../x.mp4` },
        { session_exercise_id: "se1", video_path: `${G}/se1/sub/c.mp4` },
        { session_exercise_id: "se2", video_path: `${G}/se2/d.mp4` },
        { session_exercise_id: "se1", video_path: null },
      ], ids)
    ).toEqual([`${G}/se1/a.mp4`]);
  });
  it("a storage problem is logged and the delete stands", async () => {
    const t = world();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await deleteInProgressWorkout({ db: fakeClient(t, []), admin: fakeClient(t, [], { removed: () => [] }), userId: ATHLETE, sessionId: S });
    expect(r).toEqual({ status: 200, removedVideos: 0 });
    expect(t.athlete_sessions).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("the delete runs with the caller's own client; the service role only reads paths and removes files", () => {
    const src = read("lib/delete-workout.ts");
    expect(src).toContain('await db.from("athlete_sessions").delete().eq("id", sessionId).eq("status", "in_progress").select("id")');
    expect(src).not.toContain("admin.from(\"athlete_sessions\")");
    const route = read("app/api/workout-session/delete/route.ts");
    expect(route).toContain("deleteInProgressWorkout({ db: supabase, admin: createServiceRoleClient(), userId: user.id, sessionId: body?.sessionId })");
    expect(route).toContain('if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });');
  });
  it("records (PRs) are only written at complete, so there are none to take back", () => {
    expect(read("supabase/migrations/0385_set_types_and_records.sql")).toContain("insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)");
    expect(read("supabase/migrations/0419_team_sheet_save.sql")).toContain("from public.complete_workout_session(v_session) x;");
    expect(read("lib/delete-workout.ts")).not.toContain("exercise_records");
  });
});
