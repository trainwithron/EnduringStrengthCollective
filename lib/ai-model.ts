// Which model id to ask for, and the one to retry with if the first is "not found". Pure so it can be tested.
// Sonnet 5.5 is stricter than Sonnet 5: it answers 400 if a request asks for thinking disabled or forces a tool. Our request sends neither, so the retry is safe; if
// either is ever added to callClaude, check this fallback first.
export const FALLBACK_MODEL = "claude-sonnet-5-5";

// [first id to try, id to retry with on a 404 (or null when there is nothing different to try)].
// `configured` is ANTHROPIC_MODEL, `defaultModel` the built-in default, `remembered` an id that already worked after a retry.
export function modelCandidates(configured: string | undefined, defaultModel: string, remembered: string | null = null): [string, string | null] {
  const primary = remembered || configured?.trim() || defaultModel;
  const fallback = primary === FALLBACK_MODEL ? null : FALLBACK_MODEL;
  return [primary, fallback];
}
