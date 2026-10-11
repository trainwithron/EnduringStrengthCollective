import { confirmDialog } from "@/components/shared/confirm-dialog";
import { signOffProgram } from "@/components/coach/ai-draft-banner";

// Assigning a program that is still an AI draft: ONE confirmation that does both. Approving it (the existing sign-off, which also notes what the coach changed and runs the database
// guard exactly as before) and then assigning it. An unsigned draft is never assigned or made active without this explicit confirm.
export const APPROVE_AND_ASSIGN_LABEL = "Approve and assign";
export const APPROVE_AND_ASSIGN_FAILED = "That didn't save. The program is still a draft, so it was not assigned.";

export function approveAndAssignMessage(programName: string, target: string): string {
  return `Approve "${programName}" and assign it to ${target}?`;
}

// "ok" = the program is signed off (or never needed it) and may be assigned; "cancelled" = the coach said no; "failed" = the sign-off did not save, so nothing may be assigned.
export async function ensureApproved(args: { aiDraft: boolean; programId: string; programName: string; target: string }): Promise<"ok" | "cancelled" | "failed"> {
  if (!args.aiDraft) return "ok";
  if (!(await confirmDialog({ message: approveAndAssignMessage(args.programName, args.target), confirmLabel: APPROVE_AND_ASSIGN_LABEL }))) return "cancelled";
  // Approved, but the original stays an inactive library program: only the copy that is assigned goes live (for the client, not for a whole group).
  return (await signOffProgram(args.programId, { activate: false })) ? "ok" : "failed";
}
