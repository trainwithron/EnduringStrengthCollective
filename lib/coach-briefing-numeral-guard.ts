// AI Assistant Slice 2 — the numeral-hallucination guard
// (ai_assistant_opus_deep_dive_findings.md): "every number in a generated
// sentence must trace back to the input signal bundle (or a whitelisted
// trivial derivation like a %); reject and fall back to a plain
// deterministic sentence otherwise."
//
// Deliberately strict, not clever: every number found in the text must
// exactly match a value the caller explicitly allowed. A caller wanting
// to permit a derived value (a rounded %, say) adds that computed number
// to `allowedValues` itself before calling this — the guard never tries
// to reverse-engineer "is this a plausible derivation," since a stricter
// exact-match check has far fewer ways to be fooled than a permissive
// one.
//
// Separately, the discriminated-union rule itself — only `observation`/
// `celebration` may carry a number at all, `reflective_question` never
// asserts a number — is checked by validateNoNumbers below, used
// whenever item_type is 'reflective_question'.

export function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(\.\d+)?/g);
  return matches ? matches.map(Number) : [];
}

export interface NumeralGuardResult {
  valid: boolean;
  invalidNumbers: number[];
}

export function validateNoHallucinatedNumbers(text: string, allowedValues: number[]): NumeralGuardResult {
  const found = extractNumbers(text);
  const invalidNumbers = found.filter((n) => !allowedValues.includes(n));
  return { valid: invalidNumbers.length === 0, invalidNumbers };
}

export function validateNoNumbers(text: string): boolean {
  return extractNumbers(text).length === 0;
}
