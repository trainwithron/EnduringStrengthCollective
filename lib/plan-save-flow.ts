// The order of a plan save: the PLAN is saved first, and only if that worked do the AI options in it go into the coach's library. A failed plan save must never leave a "Saved N
// new meals to your library" message (or the meals themselves) behind for a plan that does not exist.
export interface PlanSaveOutcome {
  ok: boolean;
  // The line to show about the library (null when nothing was saved or the plan itself failed).
  libraryMessage: string | null;
  // What went wrong with the plan, in words for the coach (null on success).
  error: string | null;
}

export async function savePlanThenLibrary(savePlan: () => PromiseLike<{ error: { message?: string } | null }>, saveLibrary: () => Promise<string | null>): Promise<PlanSaveOutcome> {
  let result: { error: { message?: string } | null };
  try {
    result = await savePlan();
  } catch {
    return { ok: false, libraryMessage: null, error: "The plan couldn't be saved. Check your connection and try again." };
  }
  if (result.error) return { ok: false, libraryMessage: null, error: "The plan couldn't be saved. Nothing was added to your library. Try again." };
  return { ok: true, libraryMessage: await saveLibrary(), error: null };
}
