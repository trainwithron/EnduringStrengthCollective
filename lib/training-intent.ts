// Intuitive exercise finder + intent-aware programming
// (intuitive_exercise_finder_and_intent_aware_programming.md) — a
// program's training intent drives rest/tempo tap-to-fill suggestions,
// never which exercises are selectable (that stays the coach's own
// call). Same deterministic keyword-match discipline the Programming
// Spotter already uses (lib/programming-spotter.ts) — a real, visible
// rule a coach could read and predict, not a silent AI guess.

export const TRAINING_INTENTS = [
  "Powerlifting/Strength",
  "Hypertrophy",
  "Power/Explosive",
  "Conditioning/Endurance",
  "General Fitness",
  "Sport-Specific",
  "Youth",
  "Mobility/Flow",
] as const;

export type TrainingIntent = (typeof TRAINING_INTENTS)[number];

const INTENT_KEYWORDS: Record<TrainingIntent, string[]> = {
  "Powerlifting/Strength": ["powerlifting", "strength", "max", "1rm", "squat/bench/deadlift", "sbd"],
  Hypertrophy: ["hypertrophy", "bodybuilding", "muscle", "size", "bulk"],
  "Power/Explosive": ["power", "explosive", "plyo", "jump", "olympic", "sprint"],
  "Conditioning/Endurance": ["conditioning", "endurance", "cardio", "metcon", "engine", "aerobic"],
  "General Fitness": ["general fitness", "general", "wellness", "beginner"],
  "Sport-Specific": ["football", "basketball", "baseball", "soccer", "team", "sport"],
  Youth: ["youth", "middle school", "high school", "kids", "teen"],
  "Mobility/Flow": ["mobility", "flow", "flexibility", "warm-up", "warmup", "prehab"],
};

// First keyword match wins, in the order TRAINING_INTENTS is declared —
// a name matching more than one category (e.g. "Youth Strength") picks
// the earlier-listed one deliberately (Powerlifting/Strength before
// Youth here), same "declared order breaks ties" rule the Programming
// Spotter's own phrase lists use.
export function detectTrainingIntent(programName: string): TrainingIntent | null {
  const nameLower = programName.toLowerCase();
  for (const intent of TRAINING_INTENTS) {
    if (INTENT_KEYWORDS[intent].some((kw) => nameLower.includes(kw))) {
      return intent;
    }
  }
  return null;
}

export interface RestTempoSuggestion {
  label: string;
  restSeconds: number;
  source: string;
}

// Deliberately incomplete — only the intents with a real, specific
// sourced number behind them get a tap-to-fill suggestion here.
// "Conditioning/Endurance" reuses the existing CARDIO_PRESETS
// (lib/cardio-presets.ts) rather than a new number. "General Fitness,"
// "Sport-Specific," "Mobility/Flow" have no single defensible rest
// figure — coach types their own, same "tap it, or just type what you
// want" rule as everywhere else this UX pattern is used tonight.
// "Youth" is explicitly withheld: the sourced NSCA-grounded defaults
// this would need still need a CSCS-credentialed human's sign-off
// before shipping as an auto-fill (see the research file's own
// caveat) — offering a number here would be exactly the "silent guess"
// this feature is designed to avoid.
export const REST_TEMPO_SUGGESTIONS: Partial<Record<TrainingIntent, RestTempoSuggestion[]>> = {
  "Powerlifting/Strength": [
    { label: "Heavy compound (>85%)", restSeconds: 240, source: "Standard strength-training rest for near-maximal loads" },
    { label: "Contrast/explosive pairing", restSeconds: 15, source: "Ron's own contrast-training example" },
  ],
  Hypertrophy: [
    { label: "Tier-A compound", restSeconds: 150, source: "Schoenfeld 2016" },
    { label: "Tier-B/C accessory", restSeconds: 75, source: "Standard hypertrophy accessory rest" },
  ],
  "Power/Explosive": [
    { label: "Max-effort explosive set", restSeconds: 240, source: "Bompa/ACSM power periodization" },
  ],
};
