// Which model id to ask for, and the one to retry with if the first is "not found". Pure so it can be tested.
export const FALLBACK_MODEL = "claude-sonnet-5-5";

// [first id to try, id to retry with on a 404 (or null when there is nothing different to try)].
// `configured` is ANTHROPIC_MODEL, `defaultModel` the built-in default, `remembered` an id that already worked after a retry.
export function modelCandidates(configured: string | undefined, defaultModel: string, remembered: string | null = null): [string, string | null] {
  const primary = remembered || configured?.trim() || defaultModel;
  const fallback = primary === FALLBACK_MODEL ? null : FALLBACK_MODEL;
  return [primary, fallback];
}
