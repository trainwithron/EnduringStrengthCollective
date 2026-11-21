import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "ann" } as { id: string } | null,
  se: { data: { id: "se1", group_workout_exercise_id: "gwe1", is_added: false } as any, error: null as any },
  rpc: { data: null as any, error: null as any },
  rpcCalls: [] as { name: string; args: any }[],
  inserts: [] as any[],
  pushes: [] as any[],
  coaches: [{ profile_id: "coach" }] as { profile_id: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: any) => {
      state.rpcCalls.push({ name, args });
      return state.rpc;
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => state.se }) }) }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) =>
          table === "profiles" ? { maybeSingle: async () => ({ data: { full_name: "Ann Adams" } }) } : { eq: async () => ({ data: state.coaches }) },
      }),
      insert: async (row: any) => {
        state.inserts.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/coach-notice", () => ({ sendCoachPush: async (...args: any[]) => state.pushes.push(args) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));

import { POST } from "@/app/api/program/swap-every-week/route";
import { clientSwapNotice, everyWeekDone, everyWeekQuestion, laterWeeksToChange, swapEveryWeek, undoEveryWeekSwap } from "@/lib/every-week-swap";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SE = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown) => new Request("https://app.test/api/program/swap-every-week", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  state.user = { id: "ann" };
  state.se = { data: { id: SE, group_workout_exercise_id: "gwe1", is_added: false }, error: null };
  state.rpc = { data: { swap: "sw1", changed: 3, weeks: [2, 3, 4], ids: ["a", "b", "c"], byClient: true, from: "Leg Press", to: "Hack Squat", program: "p1", group: "g1" }, error: null };
  state.rpcCalls = [];
  state.inserts = [];
  state.pushes = [];
  state.coaches = [{ profile_id: "coach" }];
});

describe("the words", () => {
  it("the coach's question, what is said after, and the coach's notice", () => {
    expect(everyWeekQuestion("Leg Press", "Hack Squat", 3)).toBe("Change Leg Press to Hack Squat just this week, or every week from here on? 3 later weeks have Leg Press in this place.");
    expect(everyWeekQuestion("Leg Press", "Hack Squat", 1)).toContain("1 later week has Leg Press");
    expect(everyWeekDone(2)).toBe("Changed in this week and 2 later weeks.");
    expect(clientSwapNotice("Ann Adams", "Leg Press", "Hack Squat")).toBe("Ann Adams swapped Leg Press for Hack Squat for every week.");
  });
});

describe("the calls", () => {
  const db = (rpc: { data: any; error: any }) => ({ rpc: async () => rpc }) as any;
  it("the check runs dry and says how many later weeks; before step 219 it says nothing (only this week changes)", async () => {
    expect(await laterWeeksToChange(db({ data: { changed: 2 }, error: null }), "e", "Hack Squat", null)).toBe(2);
    expect(await laterWeeksToChange(db({ data: null, error: { message: "Could not find the function public.swap_exercise_every_week" } }), "e", "Hack Squat", null)).toBeNull();
  });
  it("a refusal says why in plain words", async () => {
    expect(await swapEveryWeek(db({ data: null, error: { message: "not authorized" } }), "e", "X", null)).toEqual({ ok: false, error: "This can only be changed for every week on your own program." });
    expect(await swapEveryWeek(db({ data: null, error: { message: "Could not find the function" } }), "e", "X", null)).toMatchObject({ ok: false, error: expect.stringMatching(/switched on yet/) });
    const ok = await swapEveryWeek(db({ data: { swap: "s", changed: 1, ids: ["x"], byClient: false, from: "A", to: "B" }, error: null }), "e", "B", null);
    expect(ok).toMatchObject({ ok: true, result: { swap: "s", changed: 1, ids: ["x"] } });
    expect(await undoEveryWeekSwap(db({ data: 3, error: null }), "s")).toBe(3);
    expect(await undoEveryWeekSwap(db({ data: null, error: { message: "not authorized" } }), "s")).toBeNull();
  });
});

describe("every week, from a workout", () => {
  it("the client on their own program: the program changes (as them) and the coach is told, with a link to the program where it can be undone", async () => {
    const res = await POST(req({ sessionExerciseId: SE, newName: " Hack Squat " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: 3, byClient: true });
    expect(state.rpcCalls).toEqual([{ name: "swap_exercise_every_week", args: { p_exercise: "gwe1", p_new_name: "Hack Squat", p_display_name: null, p_dry_run: false } }]);
    expect(state.inserts).toEqual([{ table: "notifications", row: { profile_id: "coach", group_id: "g1", type: "exercise_swap", body: "Ann Adams swapped Leg Press for Hack Squat for every week.", link_path: "/groups/g1/programs/p1?swap=sw1" } }]);
    expect(state.pushes[0].slice(1)).toEqual(["coach", "client_activity", "Exercise swapped for every week", "Ann Adams swapped Leg Press for Hack Squat for every week.", "/groups/g1/programs/p1?swap=sw1"]);
  });

  it("a coach logging for the client: the program changes, nobody is told", async () => {
    state.user = { id: "coach" };
    state.rpc.data = { ...state.rpc.data, byClient: false };
    expect((await POST(req({ sessionExerciseId: SE, newName: "Hack Squat" }))).status).toBe(200);
    expect(state.inserts).toEqual([]);
  });

  it("refused: signed out; a team or group program (the database says no); an exercise the client added; a bad name; not switched on yet", async () => {
    state.user = null;
    expect((await POST(req({ sessionExerciseId: SE, newName: "Hack Squat" }))).status).toBe(401);
    state.user = { id: "ann" };
    state.rpc = { data: null, error: { message: "not authorized" } };
    const team = await POST(req({ sessionExerciseId: SE, newName: "Hack Squat" }));
    expect(team.status).toBe(403);
    expect(state.inserts).toEqual([]);
    state.se = { data: { id: SE, group_workout_exercise_id: "gwe1", is_added: true }, error: null };
    expect((await POST(req({ sessionExerciseId: SE, newName: "Hack Squat" }))).status).toBe(422);
    state.se = { data: { id: SE, group_workout_exercise_id: "gwe1", is_added: false }, error: null };
    expect((await POST(req({ sessionExerciseId: SE, newName: "3x5" }))).status).toBe(400);
    expect((await POST(req({ sessionExerciseId: "nope", newName: "Hack Squat" }))).status).toBe(404);
    state.rpc = { data: null, error: { message: "Could not find the function public.swap_exercise_every_week" } };
    expect((await POST(req({ sessionExerciseId: SE, newName: "Hack Squat" }))).status).toBe(503);
  });
});

describe("where it is asked", () => {
  it("in the builder (B4): asked only when later weeks have it in the same place; Every week, or Just this week; Undo puts the screen back too", () => {
    const c = src("components/coach/exercise-builder-card.tsx");
    expect(c).toContain("const later = await laterWeeksToChange(supabase, exercise.id, trimmed, display);");
    expect(c).toContain("if (later && later > 0) {");
    expect(c).toContain('confirmLabel: "Every week from here on", cancelLabel: "Just this week"');
    expect(c).toContain("onRenamedInLaterWeeks?.(done.result.ids, before.exerciseName, before.displayName);");
    expect(src("components/coach/desktop/week-grid.tsx")).toContain("onRenamedInLaterWeeks={(ids, exerciseName, displayName) => {");
  });

  it("in the workout (B5): only on the client's own one-on-one program; anywhere else a swap is for today with no question", () => {
    const page = src("app/sessions/[sessionId]/page.tsx");
    expect(page).toContain('(groupRow as { group_kind?: string | null } | null)?.group_kind === "one_on_one"');
    expect(page).toContain("(prog.athlete_id == null || prog.athlete_id === session.athlete_id)");
    expect(page).toContain("...(everyWeekSwap && se.group_workout_exercise_id && !se.is_added ? { everyWeekSwap: true } : {}),");
    const card = src("components/logging/exercise-card.tsx");
    expect(card).toContain("if (exercise.everyWeekSwap && !scope) {");
    expect(card).toContain("Just today");
    expect(card).toContain("Every week");
    expect(card).toContain('if (scope === "every") void swapForEveryWeek(name);');
  });

  it("the coach undoes a client's swap from the program (the notice opens it)", () => {
    const n = src("components/coach/desktop/client-swaps-notice.tsx");
    expect(n).toContain('.eq("by_client", true)');
    expect(n).toContain("undoEveryWeekSwap(createBrowserClient(), s.id)");
    expect(src("components/coach/desktop/program-builder-desktop.tsx")).toContain("<ClientSwapsNotice programId={programId} onDaysChange={setDays} />");
  });
});
