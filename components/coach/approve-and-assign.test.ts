import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const signOffProgram = vi.fn();
vi.mock("@/components/coach/ai-draft-banner", () => ({ signOffProgram: (id: string, options?: unknown) => signOffProgram(id, options) }));

import { APPROVE_AND_ASSIGN_FAILED, ensureSignedOff } from "@/components/coach/approve-and-assign";
import { assignProgramToClient } from "@/lib/program-duplication";

beforeEach(() => signOffProgram.mockReset());

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("assigning an AI draft: the click on Assign is the approval", () => {
  it("a program that is not a draft goes straight through: no sign-off", async () => {
    expect(await ensureSignedOff({ aiDraft: false, programId: "p" })).toBe("ok");
    expect(signOffProgram).not.toHaveBeenCalled();
  });

  it("a draft is signed off with the existing sign-off, WITHOUT making the original active, and then may be assigned", async () => {
    signOffProgram.mockResolvedValue(true);
    expect(await ensureSignedOff({ aiDraft: true, programId: "p1" })).toBe("ok");
    expect(signOffProgram).toHaveBeenCalledWith("p1", { activate: false });
  });

  it("if the sign-off does not save, nothing may be assigned, and the message says so", async () => {
    signOffProgram.mockResolvedValue(false);
    expect(await ensureSignedOff({ aiDraft: true, programId: "p1" })).toBe("failed");
    expect(APPROVE_AND_ASSIGN_FAILED).toBe("That didn't save. The program is still a draft, so it was not assigned.");
  });

  it("there is no extra approval dialog or button any more", () => {
    const src = read("components/coach/approve-and-assign.ts");
    expect(src).not.toContain("confirmDialog");
    expect(src).not.toContain("Approve and assign");
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu).not.toContain("Approve and assign");
    expect(menu).not.toContain("approveAndAssignMessage");
  });

  it("every assign path that can meet a draft signs it off first through the one helper, and the sign-off route and guard are untouched", () => {
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    expect((panel.match(/ensureSignedOff\(/g) ?? []).length).toBe(1);
    expect(read("components/coach/desktop/program-card-menu.tsx")).not.toContain("ensureSignedOff(");
    expect(read("components/coach/client-program-actions.tsx")).toContain("ensureSignedOff({ aiDraft: program.aiDraft, programId: program.id })");
    expect(read("components/coach/ai-draft-banner.tsx")).toContain('fetch("/api/ai/sign-off"');
    expect(read("app/api/ai/sign-off/route.ts")).toContain("const activate = body.activate !== false;");
  });
});

describe("the first person gets the original, later people get a copy (Ron: \"first person gets the original\")", () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const fake = (data: unknown, error: unknown = null) => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { single: async () => ({ data, error }) };
    },
  });
  it("asks the database step, with no client name, and passes on whether the program itself was handed over", async () => {
    calls.length = 0;
    const handed = await assignProgramToClient(fake({ assigned_program_id: "p1", was_attached: true }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a", startDate: "2026-12-01" });
    expect(handed).toEqual({ programId: "p1", attached: true });
    expect(calls[0]).toEqual({ name: "assign_program_to_client", args: { p_program_id: "p1", p_destination_group_id: "g", p_athlete_id: "a", p_client_name: null, p_start_date: "2026-12-01" } });
    const copied = await assignProgramToClient(fake({ assigned_program_id: "p2", was_attached: false }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "b" });
    expect(copied).toEqual({ programId: "p2", attached: false });
    expect(calls[1].args.p_start_date).toBeNull();
  });
  it("an error from the database is passed on as it is", async () => {
    expect(await assignProgramToClient(fake(null, { message: "That client is not in that group." }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a" })).toEqual({ error: "That client is not in that group." });
    expect(await assignProgramToClient(fake(null) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a" })).toEqual({ error: "Couldn't assign the program." });
  });

  it("the Assign panel, the client's Programs tab, the banner and Use template assign through it; the package auto-assign, Stripe and Duplicate still copy", () => {
    expect(read("components/coach/desktop/program-assign-panel.tsx")).toContain("assignProgramToClient(supabase");
    expect(read("components/coach/client-program-actions.tsx")).toContain("assignProgramToClient(supabase");
    expect(read("app/api/coach/package-assignments/route.ts")).toContain("duplicateProgram(");
    const lib = read("lib/program-duplication.ts");
    expect(lib).toContain('.rpc("assign_program_to_client", {');
    expect(lib).toContain("return { programId: row.assigned_program_id, attached: row.was_attached === true };");
  });

  it("the database step (0424): 0337 word for word plus the three conditions; no delete; the same grants", () => {
    const sql = read("supabase/migrations/0424_first_assignee_gets_the_original.sql");
    const old = read("supabase/migrations/0337_assign_same_org_only.sql");
    expect(sql).toContain("(v_kind = 'one_on_one' or src.is_active = false or not exists (select 1 from public.group_memberships gm where gm.group_id = src.group_id and gm.role = 'athlete'))");
    expect(sql).toContain("and not exists (select 1 from public.programs c where c.source_program_id = src.id and c.archived_at is null)");
    expect(sql).toContain("and not exists (select 1 from public.workouts w join public.group_workout_exercises e on e.workout_id = w.id where w.program_id = src.id and e.is_slot)");
    // every other 0337 line is kept as it was
    const body = (s: string) => s.slice(s.indexOf("create or replace function"));
    const kept = body(old).split("\n").filter((l) => !l.includes("(v_kind = 'one_on_one' or src.is_active = false)"));
    for (const line of kept) expect(body(sql), line).toContain(line);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).toContain("grant execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) to authenticated, service_role;");
  });

  it("the database step: attach only a no-client, non-draft program that is a one-on-one template or inactive, with no history; it moves the children and activates; otherwise it copies", () => {
    const sql = read("supabase/migrations/0335_assign_program_to_client.sql");
    expect(sql).toContain("src.athlete_id is null");
    expect(sql).toContain("not src.ai_draft");
    expect(sql).toContain("(v_kind = 'one_on_one' or src.is_active = false)");
    for (const table of ["workout_logs", "athlete_sessions", "workout_assignments", "challenges"]) expect(sql).toContain(table);
    for (const table of ["public.workouts set", "public.group_workout_exercises e set", "public.workout_notes n set", "public.exercise_progressions set"]) expect(sql).toContain(table);
    expect(sql).toContain("coach_packages cp where cp.default_program_id = src.id");
    expect(sql).toContain("athlete_exercise_overrides o");
    expect(sql).toContain("That client is not in that group.");
    expect(sql).toContain("is_active = true");
    expect(sql).toContain("public.duplicate_program(");
    expect(sql).not.toMatch(/delete from/);
    expect(sql).toContain("revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;");
  });
});
