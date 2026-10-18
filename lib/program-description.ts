// The description of a program: a few plain sentences the coach types (or keeps from what the AI wrote) and clients see where they already see a program's description. Saved exactly as typed, apart from line endings and
// blank space at the two ends; an empty one is stored as nothing.
export const PROGRAM_DESCRIPTION_MAX = 2000;

export function tidyProgramDescription(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").replace(/\r\n/g, "\n").trim().slice(0, PROGRAM_DESCRIPTION_MAX);
  return cleaned === "" ? null : cleaned;
}

// "123 / 2000", turning to a warning when there is little room left.
export function descriptionCounter(text: string): { label: string; nearLimit: boolean } {
  const used = text.length;
  return { label: `${used} / ${PROGRAM_DESCRIPTION_MAX}`, nearLimit: used >= PROGRAM_DESCRIPTION_MAX - 100 };
}

// Saves the description and tells the truth: the update must come back with the row (row security turns a refused update into "no error, no rows", which would otherwise look saved).
type UpdateClient = { from: (table: "programs") => { update: (values: { description: string | null }) => { eq: (column: string, value: string) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }> & { select: (columns: string) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }> } } } };
export async function saveProgramDescription(supabase: UpdateClient, programId: string, text: string): Promise<{ ok: true; description: string | null } | { ok: false; error: string }> {
  const next = tidyProgramDescription(text);
  const { checked } = await import("@/lib/checked-write");
  const result = await checked(supabase.from("programs").update({ description: next }).eq("id", programId).select("id"), { expectRows: true, message: "Couldn't save the description." });
  return result.ok ? { ok: true, description: next } : { ok: false, error: result.error ?? "Couldn't save the description." };
}
