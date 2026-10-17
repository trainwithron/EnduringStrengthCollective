// The order of the health-form submit, kept in one place so it can be tested without a database: (1) the record of exactly what was signed is made and saved FIRST, (2) only then is the intake marked complete.
// If the record cannot be saved, nothing is marked complete and there is nothing to undo. If the record is saved and the completion write fails, the client signs once more (a second record of the same
// signature is harmless).
export type FinishIntakeResult = { ok: true } | { ok: false; step: "record" | "write" };

export interface FinishIntakeSteps {
  // Makes the text of what is being signed (null when it cannot be made).
  buildSnapshot: (signing: { groupId: string; signedName: string; signedAtIso: string }) => Promise<string | null>;
  // Saves the record of the signature; true when it was saved.
  record: (snapshot: string) => Promise<boolean>;
  // Marks the intake complete; true when exactly that row was written.
  writeComplete: (completedAtIso: string) => Promise<boolean>;
}

export async function finishIntake(input: { groupId: string; signedName: string; now: Date }, steps: FinishIntakeSteps): Promise<FinishIntakeResult> {
  const completedAt = input.now.toISOString();
  const snapshot = await steps.buildSnapshot({ groupId: input.groupId, signedName: input.signedName, signedAtIso: completedAt });
  if (!snapshot || !(await steps.record(snapshot))) return { ok: false, step: "record" };
  if (!(await steps.writeComplete(completedAt))) return { ok: false, step: "write" };
  return { ok: true };
}
