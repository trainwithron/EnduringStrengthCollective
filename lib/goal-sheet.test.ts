import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGoalSheet, goalSheetHasAnswers, goalSheetWaitingOnClient, GOAL_SHEET_QUESTIONS, GOAL_SHEET_HINTS, EMPTY_GOAL_SHEET } from "./goal-sheet";
import { goalSheetActor } from "./goal-sheet-server";
import { SAVING_API } from "./workspace-mutation";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const G = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function fakes(seatRole: string | null, isCoach: boolean) {
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: seatRole ? { role: seatRole } : null }) }) }) }),
    }),
  };
  const supabase = { rpc: async () => ({ data: isCoach }) };
  return { db: db as never, supabase: supabase as never };
}

describe("the goal sheet (Ron, Nov 2)", () => {
  it("asks Ron's questions in his words, the commitment 1-10 question replaced by his three", () => {
    expect(GOAL_SHEET_QUESTIONS.want_score).toBe("How bad do you want this?");
    expect(GOAL_SHEET_QUESTIONS.want_why).toBe("Why that number?");
    expect(GOAL_SHEET_QUESTIONS.work_willing).toBe("How hard are you willing to work for it?");
    expect(GOAL_SHEET_HINTS.work_willing).toBe("This affects the plan.");
    expect(GOAL_SHEET_QUESTIONS.food).toBe("The last 3 days of eating");
    expect(JSON.stringify(GOAL_SHEET_QUESTIONS)).not.toMatch(/committed/i);
  });

  it("a save keeps trimmed answers, drops blanks, cuts long text, and takes the numbers only when whole and in range", () => {
    const out = cleanGoalSheet({ why_matters: "  my kids ", obstacles: "   ", food_day_1: "x".repeat(2500), days_per_week: "4", want_score: 11, extra: "ignored" });
    expect(out.why_matters).toBe("my kids");
    expect(out.obstacles).toBeNull();
    expect(out.food_day_1).toHaveLength(2000);
    expect(out.days_per_week).toBe(4);
    expect(out.want_score).toBeNull();
    expect(Object.keys(out).sort()).toEqual(Object.keys(EMPTY_GOAL_SHEET).sort());
    expect(cleanGoalSheet({ days_per_week: 2.5, want_score: 0 })).toMatchObject({ days_per_week: null, want_score: null });
    expect(cleanGoalSheet(null)).toEqual(EMPTY_GOAL_SHEET);
  });

  it("knows when it has answers, and when the client is still asked to fill it in", () => {
    expect(goalSheetHasAnswers(EMPTY_GOAL_SHEET)).toBe(false);
    expect(goalSheetHasAnswers({ ...EMPTY_GOAL_SHEET, want_score: 7 })).toBe(true);
    expect(goalSheetWaitingOnClient(null)).toBe(false);
    expect(goalSheetWaitingOnClient({ requested_at: "2026-11-02T10:00:00Z", filled_at: null })).toBe(true);
    expect(goalSheetWaitingOnClient({ requested_at: "2026-11-02T10:00:00Z", filled_at: "2026-11-01T10:00:00Z" })).toBe(true);
    expect(goalSheetWaitingOnClient({ requested_at: "2026-11-02T10:00:00Z", filled_at: "2026-11-02T11:00:00Z" })).toBe(false);
  });

  it("only the client for themselves, or a coach of the group for one of its clients, may save or send it", async () => {
    let f = fakes("athlete", false);
    expect(await goalSheetActor(f.supabase, f.db, A, G, A)).toEqual({ role: "client" });
    f = fakes("athlete", true);
    expect(await goalSheetActor(f.supabase, f.db, C, G, A)).toEqual({ role: "coach" });
    f = fakes("athlete", false);
    expect(await goalSheetActor(f.supabase, f.db, C, G, A)).toBeNull();
    f = fakes(null, true);
    expect(await goalSheetActor(f.supabase, f.db, C, G, A)).toBeNull();
    f = fakes("coach", true);
    expect(await goalSheetActor(f.supabase, f.db, C, G, A), "a coach of the group is not a client to send a sheet to").toBeNull();
    expect(await goalSheetActor(f.supabase, f.db, C, "nope", A)).toBeNull();
  });

  it("the database step: read by the client and the group's coaches only, written only by the server", () => {
    const sql = read("supabase/migrations/0442_client_goal_sheets.sql");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.client_goal_sheets from authenticated;");
    expect(sql).toContain("revoke all on public.client_goal_sheets from anon;");
    expect(sql).toContain("using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));");
    expect(sql).toContain("unique (athlete_id, group_id)");
    expect(sql).toContain('create policy "org_wall_header" on public.client_goal_sheets as restrictive');
    expect(sql).not.toMatch(/for (insert|update|delete) to authenticated/);
  });

  it("the routes check who is asking; only a coach can send; filling in a sent sheet tells that coach", () => {
    const save = read("app/api/goal-sheet/route.ts");
    const send = read("app/api/goal-sheet/send/route.ts");
    for (const r of [save, send]) {
      expect(r).toContain("auth.getUser()");
      expect(r).toContain("goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId)");
      expect(r).toContain("rateLimitResponse(");
    }
    expect(send).toContain('if (actor?.role !== "coach")');
    expect(save).toContain('actor.role === "client" && before?.requested_by && goalSheetWaitingOnClient(before)');
    expect(save).not.toContain("requested_by: user.id");
    expect(SAVING_API.test("/api/goal-sheet")).toBe(true);
    expect(SAVING_API.test("/api/goal-sheet/send")).toBe(true);
  });

  it("sits on the client's goal page and on the coach's view of that client", () => {
    expect(read("app/(coach)/groups/[groupId]/goal/page.tsx")).toContain('viewer="client"');
    expect(read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain('viewer="coach"');
  });
});
