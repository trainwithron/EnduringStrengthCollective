// Validates an LLM's raw suggested-tag JSON against the real, fixed
// biomech_tags vocabulary before it's ever shown to a coach or written
// anywhere — biomech_redundancy_tagging_backfill_scoping_sept19.md's
// "suggest-and-confirm, never auto-assign" contract starts here: a
// hallucinated key, a malformed role, or a duplicate never reaches the
// UI. Pure and dependency-free so it's independently testable from the
// actual API call.
export interface BiomechTagSuggestion {
  key: string;
  role: "prime_mover" | "stabilizer_demand";
}

export function parseBiomechTagSuggestions(raw: unknown, validTagKeys: Set<string>): BiomechTagSuggestion[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: BiomechTagSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    const role = (item as { role?: unknown }).role;
    if (typeof key !== "string" || !validTagKeys.has(key)) continue;
    if (role !== "prime_mover" && role !== "stabilizer_demand") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ key, role });
  }
  return result;
}
