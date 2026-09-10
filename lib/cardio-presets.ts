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

export const CARDIO_PRESETS: CardioPreset[] = [
  { key: "alacticPower", label: "Alactic Power", workSeconds: 9, restSeconds: 55, rounds: 8 },
  { key: "alacticCapacity", label: "Alactic Capacity", workSeconds: 17, restSeconds: 35, rounds: 10 },
  { key: "glycolytic", label: "Glycolytic", workSeconds: 45, restSeconds: 90, rounds: 6 },
  { key: "aerobic", label: "Aerobic (intervals)", workSeconds: 180, restSeconds: 90, rounds: 4 },
];
