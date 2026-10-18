import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOLLOWED_PROGRAM_MESSAGE, programIsFollowed, readProgramIsFollowed } from "./ai-live-program";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the AI does not change a program clients are following", () => {
  it("followed = switched on, not an unsigned AI draft, and someone has started a workout in it", () => {
    expect(programIsFollowed({ isActive: true, aiDraft: false, hasStartedWorkouts: true })).toBe(true);
    // a program being built (a new client's program is switched on from the start, with nothing started) is free to build
    expect(programIsFollowed({ isActive: true, aiDraft: false, hasStartedWorkouts: false })).toBe(false);
    expect(programIsFollowed({ isActive: false, aiDraft: false, hasStartedWorkouts: true })).toBe(false);
    expect(programIsFollowed({ isActive: true, aiDraft: true, hasStartedWorkouts: true })).toBe(false);
  });

  it("the route refuses before it charges anything, with a plain message", () => {
    const route = src("app/api/ai/build-day/route.ts");
    const check = route.indexOf("readProgramIsFollowed(supabase, programId)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(route.indexOf("canRunAiAction("));
    expect(check).toBeLessThan(route.indexOf("freeTierUseOrRefuse("));
    expect(route).toContain('FOLLOWED_PROGRAM_MESSAGE, code: "program_followed" }, { status: 409 }');
    expect(FOLLOWED_PROGRAM_MESSAGE).toContain("Make a copy first");
  });

  it("when it cannot tell, it counts the program as followed and the AI writes nothing", async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) } as never;
    expect(await readProgramIsFollowed(failing, "p")).toBe(true);
    const make = (opts: { active: boolean; draft?: boolean; workouts?: string[]; sessions?: number; workoutsError?: boolean }) =>
      ({
        from: (table: string) => {
          const q: any = {
            select: () => q,
            eq: () => q,
            in: () => q,
            maybeSingle: async () => ({ data: { is_active: opts.active, ai_draft: !!opts.draft }, error: null }),
            then: (r: (v: unknown) => void) => r(table === "workouts" ? { data: (opts.workouts ?? []).map((id) => ({ id })), error: opts.workoutsError ? { message: "x" } : null } : { count: opts.sessions ?? 0, error: null }),
          };
          return q;
        },
      }) as never;
    expect(await readProgramIsFollowed(make({ active: true, workouts: ["w"], sessions: 3 }), "p")).toBe(true);
    expect(await readProgramIsFollowed(make({ active: true, workouts: ["w"], sessions: 0 }), "p")).toBe(false);
    expect(await readProgramIsFollowed(make({ active: true, workouts: [], sessions: 0 }), "p")).toBe(false);
    expect(await readProgramIsFollowed(make({ active: false, workouts: ["w"], sessions: 3 }), "p")).toBe(false);
    expect(await readProgramIsFollowed(make({ active: true, draft: true, workouts: ["w"], sessions: 3 }), "p")).toBe(false);
    expect(await readProgramIsFollowed(make({ active: true, workoutsError: true }), "p")).toBe(true);
  });

  it("the builder box shows the server's sentence", () => {
    expect(src("components/coach/desktop/ai-program-builder-box.tsx")).toContain("(data.error as string | undefined) ?? COULDNT");
  });
});
