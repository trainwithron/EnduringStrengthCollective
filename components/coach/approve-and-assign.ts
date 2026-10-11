import { signOffProgram } from "@/components/coach/ai-draft-banner";

// Assigning a program that is still an AI draft: the coach's click on Assign IS the approval. There is no extra dialog. The EXISTING sign-off runs first (the same route: the sign-off
// record, the learning capture and the database guard, exactly as when the coach signs off from the banner), and only then is the program assigned. If the sign-off does not save, nothing
// is assigned. The original is approved but NOT made active (activate: false): the program that is assigned is what goes live, for the client, not for a whole group.
export const APPROVE_AND_ASSIGN_FAILED = "That didn't save. The program is still a draft, so it was not assigned.";

// "ok" = the program is signed off (or never needed it) and may be assigned; "failed" = the sign-off did not save, so nothing may be assigned.
export async function ensureSignedOff(args: { aiDraft: boolean; programId: string }): Promise<"ok" | "failed"> {
  if (!args.aiDraft) return "ok";
  return (await signOffProgram(args.programId, { activate: false })) ? "ok" : "failed";
}
