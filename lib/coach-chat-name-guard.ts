// AI Assistant Phase 2 — the "name guard"
// (collective_intelligence_phase_2_conversational_assistant.md). Same
// shape/philosophy as lib/coach-briefing-numeral-guard.ts, checking proper
// names instead of numbers: the chat may only ever mention an athlete the
// coach actually asked about (i.e. one that was resolved and looked up
// THIS turn) — it must never volunteer an unprompted mention of a
// different client. Deliberately a strict exact-substring blacklist
// against the coach's own full roster (minus whoever was legitimately
// resolved this turn), not an NLP name-detector — same "a stricter
// exact-match check has far fewer ways to be fooled" reasoning the
// numeral guard already uses.

export interface NameGuardResult {
  valid: boolean;
  violatingNames: string[];
}

export function validateNoUnresolvedAthleteNames(
  text: string,
  resolvedNames: string[],
  allRosterNames: string[]
): NameGuardResult {
  const lowerText = text.toLowerCase();
  const resolvedLower = new Set(resolvedNames.map((n) => n.toLowerCase()));
  const violatingNames = allRosterNames.filter(
    (name) => !resolvedLower.has(name.toLowerCase()) && lowerText.includes(name.toLowerCase())
  );
  return { valid: violatingNames.length === 0, violatingNames };
}
