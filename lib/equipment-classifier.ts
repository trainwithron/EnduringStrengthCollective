// Keyword-based suggestion for exercise_library.equipment_type (see
// supabase/migrations/0134_exercise_equipment_type.sql). Mirrors
// lib/exercise-category-classifier.ts exactly — same substring-anywhere
// matching, same "SUGGESTION only, never auto-assign" contract. An
// exercise name that already signals its movement pattern via keyword
// ("Kettlebell Swing") equally well signals its equipment the same way.

export type EquipmentType =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "machine"
  | "cable"
  | "band"
  | "bodyweight";

interface KeywordRule {
  keyword: string;
  equipmentType: EquipmentType;
}

// Checked top to bottom, first match wins — most specific phrases first
// so e.g. "Cable Machine Row" resolves to Cable (the thing actually
// gripped/moved) rather than the more generic "machine".
const KEYWORD_RULES: KeywordRule[] = [
  { keyword: "barbell", equipmentType: "barbell" },
  { keyword: "trap bar", equipmentType: "barbell" },
  { keyword: "ez bar", equipmentType: "barbell" },
  { keyword: "ez-bar", equipmentType: "barbell" },

  { keyword: "dumbbell", equipmentType: "dumbbell" },
  { keyword: "db ", equipmentType: "dumbbell" },

  { keyword: "kettlebell", equipmentType: "kettlebell" },
  { keyword: "kb ", equipmentType: "kettlebell" },

  { keyword: "cable", equipmentType: "cable" },
  { keyword: "band", equipmentType: "band" },
  { keyword: "resistance band", equipmentType: "band" },

  // "machine" checked after cable/band so a name like "cable machine"
  // still resolves to the more specific "cable" rule above.
  { keyword: "machine", equipmentType: "machine" },
  { keyword: "leg press", equipmentType: "machine" },
  { keyword: "smith", equipmentType: "machine" },
  { keyword: "hack squat", equipmentType: "machine" },
  { keyword: "lat pulldown", equipmentType: "machine" },
  { keyword: "seated row", equipmentType: "machine" },

  { keyword: "push-up", equipmentType: "bodyweight" },
  { keyword: "push up", equipmentType: "bodyweight" },
  { keyword: "pushup", equipmentType: "bodyweight" },
  { keyword: "pull-up", equipmentType: "bodyweight" },
  { keyword: "pull up", equipmentType: "bodyweight" },
  { keyword: "pullup", equipmentType: "bodyweight" },
  { keyword: "chin-up", equipmentType: "bodyweight" },
  { keyword: "chin up", equipmentType: "bodyweight" },
  { keyword: "dip", equipmentType: "bodyweight" },
  { keyword: "plank", equipmentType: "bodyweight" },
  { keyword: "sit-up", equipmentType: "bodyweight" },
  { keyword: "sit up", equipmentType: "bodyweight" },
  { keyword: "bodyweight", equipmentType: "bodyweight" },
  { keyword: "burpee", equipmentType: "bodyweight" },
  { keyword: "lunge", equipmentType: "bodyweight" },
  { keyword: "mountain climber", equipmentType: "bodyweight" },
];

export function classifyEquipmentType(name: string): EquipmentType | null {
  const normalized = name.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (normalized.includes(rule.keyword)) return rule.equipmentType;
  }
  return null;
}
