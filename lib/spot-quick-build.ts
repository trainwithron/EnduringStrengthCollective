// Pure parsing for the Spot's builder panel compact input line
// (the_spot_dropdown_widget_redesign_sept16.md, "REVISED 2026-09-19"
// section) — Ron asked for ONE compact line that supports both NL
// parsing of what's typed AND full AI generation from the same line,
// without specifying the exact mechanism. Judgment call made here:
// the raw text is always usable as-is for a direct "Generate" (the AI
// generator already understands natural language robustly), and this
// same text is ALSO run through a cheap, local, no-API-call heuristic
// extractor to prefill the structured fields (weeks/progression/style)
// if the coach chooses to "Refine details" before generating — one
// input, two uses, no second text field and no extra AI round trip
// just to populate a few dropdowns.
export const PROGRESSION_RULES = ["Let AI decide", "Linear", "Double Progression", "Undulating"] as const;
export type ProgressionRule = (typeof PROGRESSION_RULES)[number];

const STYLE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /conjugate|westside/i, label: "Conjugate" },
  { pattern: /juggernaut/i, label: "Juggernaut" },
  { pattern: /5\s*\/\s*3\s*\/\s*1|\b531\b/i, label: "5/3/1" },
  { pattern: /gzclp/i, label: "GZCLP" },
  { pattern: /block periodization/i, label: "Block Periodization" },
  { pattern: /push[\s-]?pull[\s-]?legs|\bppl\b/i, label: "Push/Pull/Legs" },
];

export interface QuickBuildGuess {
  weeks: number | null;
  progressionRule: ProgressionRule | null;
  style: string | null;
}

export function parseQuickBuildInput(text: string): QuickBuildGuess {
  const weeksMatch = text.match(/(\d{1,2})\s*-?\s*weeks?\b/i);
  const weeks = weeksMatch ? Math.min(16, Math.max(1, parseInt(weeksMatch[1], 10))) : null;

  let progressionRule: ProgressionRule | null = null;
  if (/undulating|\bdup\b/i.test(text)) progressionRule = "Undulating";
  else if (/double progression/i.test(text)) progressionRule = "Double Progression";
  else if (/linear progression|\blinear\b/i.test(text)) progressionRule = "Linear";

  let style: string | null = null;
  for (const { pattern, label } of STYLE_PATTERNS) {
    if (pattern.test(text)) {
      style = label;
      break;
    }
  }

  return { weeks, progressionRule, style };
}
