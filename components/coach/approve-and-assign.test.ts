import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const confirmDialog = vi.fn();
const signOffProgram = vi.fn();
vi.mock("@/components/shared/confirm-dialog", () => ({ confirmDialog: (o: unknown) => confirmDialog(o) }));
vi.mock("@/components/coach/ai-draft-banner", () => ({ signOffProgram: (id: string) => signOffProgram(id) }));

import { APPROVE_AND_ASSIGN_LABEL, approveAndAssignMessage, ensureApproved } from "@/components/coach/approve-and-assign";

beforeEach(() => {
  confirmDialog.mockReset();
  signOffProgram.mockReset();
});

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("approve and assign an AI draft in one confirmation", () => {
  it("the wording", () => {
    expect(approveAndAssignMessage("Strength Block", "Karina Ramirez")).toBe('Approve "Strength Block" and assign it to Karina Ramirez?');
    expect(APPROVE_AND_ASSIGN_LABEL).toBe("Approve and assign");
  });

  it("a program that is not a draft goes straight through with no question and no sign-off", async () => {
    expect(await ensureApproved({ aiDraft: false, programId: "p", programName: "P", target: "T" })).toBe("ok");
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(signOffProgram).not.toHaveBeenCalled();
  });

  it("a draft asks once, then signs it off (the existing sign-off), then it may be assigned", async () => {
    confirmDialog.mockResolvedValue(true);
    signOffProgram.mockResolvedValue(true);
    expect(await ensureApproved({ aiDraft: true, programId: "p1", programName: "Block", target: "Karina" })).toBe("ok");
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(confirmDialog).toHaveBeenCalledWith({ message: 'Approve "Block" and assign it to Karina?', confirmLabel: "Approve and assign" });
    expect(signOffProgram).toHaveBeenCalledWith("p1");
  });

  it("if the coach says no, nothing is signed off and nothing may be assigned", async () => {
    confirmDialog.mockResolvedValue(false);
    expect(await ensureApproved({ aiDraft: true, programId: "p1", programName: "Block", target: "Karina" })).toBe("cancelled");
    expect(signOffProgram).not.toHaveBeenCalled();
  });

  it("if the sign-off does not save, nothing may be assigned", async () => {
    confirmDialog.mockResolvedValue(true);
    signOffProgram.mockResolvedValue(false);
    expect(await ensureApproved({ aiDraft: true, programId: "p1", programName: "Block", target: "Karina" })).toBe("failed");
  });

  it("every assign path that can meet a draft goes through it, and the database guard and the sign-off route are untouched", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu).toContain("ensureApproved(");
    expect(menu).toContain("approveAndAssignMessage(programName,");
    expect(read("components/coach/client-program-actions.tsx")).toContain("ensureApproved(");
    expect(read("components/coach/ai-draft-banner.tsx")).toContain('fetch("/api/ai/sign-off"');
    expect(read("app/api/ai/sign-off/route.ts")).toContain("coach_program_signoffs");
  });
});
