// Starting values for each energy system, from the coach's own stated
// ranges. A single representative value inside each stated range —
// fully editable after applying, same as every other prefilled default
// in this app (e.g. DEFAULT_UNDULATING_WAVE in lib/progression-models.ts).
export interface CardioPreset {
  key: string;
  label: string;
  workSeconds: number;
  restSeconds: number;
  rounds: number;
}

// Machines and conditioning work that are trained by energy system, not reps and pounds. Narrower than the "Cardio/Mobility" category (which also holds
// stretches and carries), and whole words only, so "crunch" is not a run and "bent-over row" is not a rower. Running stays with Runner mode.
const CONDITIONING = /\b(assault|air ?dyne|echo bike|air bike|fan bike|bike|cycl(e|ing)|spin|rower|row erg|rowing machine|indoor row|ski ?erg|erg|elliptical|stair ?(climber|master|mill)|versa ?climber|jump rope|skipping|battle ropes?|burpees?|sled (push|pull|drag)|prowler|shuttles?|conditioning|intervals?|swim(ming)?)\b/i;

export function isConditioningExercise(name: string | null | undefined): boolean {
  return !!name && CONDITIONING.test(name);
}

export const CARDIO_PRESETS: CardioPreset[] = [
  { key: "alacticPower", label: "Alactic Power", workSeconds: 9, restSeconds: 55, rounds: 8 },
  { key: "alacticCapacity", label: "Alactic Capacity", workSeconds: 17, restSeconds: 35, rounds: 10 },
  { key: "glycolytic", label: "Glycolytic", workSeconds: 45, restSeconds: 90, rounds: 6 },
  { key: "aerobic", label: "Aerobic (intervals)", workSeconds: 180, restSeconds: 90, rounds: 4 },
  // High school football's real work:rest ratio is ~1:4 (7s play, 25s
  // between snaps — no TV timeouts, faster tempo than NCAA's ~1:6 or the
  // NFL's ~1:8), and none of the presets above match it. 12 rounds is
  // one series-plus. See football_program_design_and_template memory.
  { key: "hsFootballPlaySim", label: "HS Football Play Sim", workSeconds: 7, restSeconds: 25, rounds: 12 },
];
