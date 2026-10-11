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
    // the position flow keeps its own existing confirm, labelled Assign
    expect(menu).toContain('confirmLabel: "Assign"');
  });

  it("every assign path that can meet a draft signs it off first through the one helper, and the sign-off route and guard are untouched", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect((menu.match(/ensureSignedOff\(/g) ?? []).length).toBe(3);
    expect(read("components/coach/client-program-actions.tsx")).toContain("ensureSignedOff({ aiDraft: program.aiDraft, programId: program.id })");
    expect(read("components/coach/ai-draft-banner.tsx")).toContain('fetch("/api/ai/sign-off"');
    expect(read("app/api/ai/sign-off/route.ts")).toContain("const activate = body.activate !== false;");
  });
});

describe("assign to ONE client: attach when nothing depends on the program, else copy (migration 0335)", () => {
  it("calls the one database step and reports whether it attached", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const fake = (row: unknown, error: unknown = null) => ({
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { single: async () => ({ data: row, error }) };
      },
    });
    const attached = await assignProgramToClient(fake({ assigned_program_id: "p1", was_attached: true }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a", clientName: "Will", startDate: "2026-12-01" });
    expect(attached).toEqual({ programId: "p1", attached: true });
    expect(calls[0]).toEqual({ name: "assign_program_to_client", args: { p_program_id: "p1", p_destination_group_id: "g", p_athlete_id: "a", p_client_name: "Will", p_start_date: "2026-12-01" } });
    const copied = await assignProgramToClient(fake({ assigned_program_id: "p2", was_attached: false }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a" });
    expect(copied).toEqual({ programId: "p2", attached: false });
    const failed = await assignProgramToClient(fake(null, { message: "nope" }) as never, { sourceProgramId: "p1", destinationGroupId: "g", athleteId: "a" });
    expect(failed).toEqual({ error: "nope" });
  });

  it("only the single-client paths attach; a position, several people, Assign to Myself, Duplicate and the package auto-assign still copy", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    const single = menu.slice(menu.indexOf("async function handleAssignToClient"), menu.indexOf("async function handleAssignToSelf"));
    expect(single).toContain("assignProgramToClient(supabase");
    const position = menu.slice(menu.indexOf("async function handleAssignToPosition"), menu.indexOf("async function handleAssignToClient"));
    expect(position).toContain("duplicateProgram(supabase");
    expect(position).not.toContain("assignProgramToClient");
    const self = menu.slice(menu.indexOf("async function handleAssignToSelf"));
    expect(self.slice(0, 1500)).toContain("duplicateProgram(supabase");
    expect(read("app/api/coach/package-assignments/route.ts")).toContain("duplicateProgram(");
    expect(read("components/coach/client-program-actions.tsx")).toContain("assignProgramToClient(supabase");
  });

  it("the database step: attach only a no-client, non-draft program that is a one-on-one template or inactive, with no history; it moves the children and activates; otherwise it copies", () => {
    const sql = read("supabase/migrations/0335_assign_program_to_client.sql");
    expect(sql).toContain("src.athlete_id is null");
    expect(sql).toContain("not src.ai_draft");
    expect(sql).toContain("(v_kind = 'one_on_one' or src.is_active = false)");
    for (const table of ["workout_logs", "athlete_sessions", "workout_assignments", "challenges"]) expect(sql).toContain(table);
    for (const table of ["public.workouts set", "public.group_workout_exercises e set", "public.workout_notes n set", "public.exercise_progressions set"]) expect(sql).toContain(table);
    expect(sql).toContain("is_active = true");
    expect(sql).toContain("public.duplicate_program(");
    expect(sql).not.toMatch(/delete from/);
    expect(sql).toContain("revoke execute on function public.assign_program_to_client(uuid, uuid, uuid, text, date) from public, anon;");
  });
});
