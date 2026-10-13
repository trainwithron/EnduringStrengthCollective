// Ron's movement-pattern taxonomy and the starter ladders that go with it. A coach taps "Add the starter ladders" once and gets a ladder for every pattern, easiest at the top. Pure, so it is tested.
//
//   Patterns (his ten):  Hinge, Squat, Vertical Press, Vertical Pull, Horizontal Press, Horizontal Pull, Core: Rotation / Anti-rotation / Flexion / Extension (back extension)
//   Extras:              Core: Stability (planks, rollouts: anti-extension), Loaded Carry, Elbow Flexion (Biceps), Elbow Extension (Triceps)
//   A unilateral version of each is NOT a separate pattern: it is the same pattern with the exercise marked one-sided (a lunge is a unilateral squat).
//   Class: A = main lift (a deadlift), B = second lift (a lat pulldown), C = accessory (a bicep curl).

export type Tier = "A" | "B" | "C";
export type Plane = "sagittal" | "frontal" | "transverse";

export const TIER_KEY = "A = main lift, B = second lift, C = accessory";

export interface StarterPattern {
  name: string;
  plane: Plane;
  // One of Ron's ten, or an extra pattern.
  core: boolean;
}

export const STARTER_PATTERNS: StarterPattern[] = [
  { name: "Hinge", plane: "sagittal", core: true },
  { name: "Squat", plane: "sagittal", core: true },
  { name: "Vertical Press", plane: "sagittal", core: true },
  { name: "Vertical Pull", plane: "sagittal", core: true },
  { name: "Horizontal Press", plane: "sagittal", core: true },
  { name: "Horizontal Pull", plane: "sagittal", core: true },
  { name: "Core: Rotation", plane: "transverse", core: true },
  { name: "Core: Anti-rotation", plane: "transverse", core: true },
  { name: "Core: Flexion", plane: "sagittal", core: true },
  { name: "Core: Extension", plane: "sagittal", core: true },
  { name: "Core: Stability", plane: "sagittal", core: false },
  { name: "Loaded Carry", plane: "frontal", core: false },
  { name: "Elbow Flexion (Biceps)", plane: "sagittal", core: false },
  { name: "Elbow Extension (Triceps)", plane: "sagittal", core: false },
];

export interface StarterRung {
  pattern: string;
  exercise: string;
  // Order within the pattern, easiest first. Only the order matters.
  rank: number;
  tier: Tier;
  unilateral: boolean;
}

// pattern, exercise, rank, tier, one-sided
type Row = [string, string, number, Tier, boolean];
const ROWS: Row[] = [
  // Squat (a lunge, split squat or step-up is the one-sided squat)
  ["Squat", "Bodyweight Squat", 0, "C", false],
  ["Squat", "Zombie Squat", 1, "C", false],
  ["Squat", "Leg Extension", 2, "C", false],
  ["Squat", "Goblet Squat", 3, "B", false],
  ["Squat", "Barbell Box Squat", 4, "B", false],
  ["Squat", "Leg Press", 4, "B", false],
  ["Squat", "Zercher Squat", 6, "B", false],
  ["Squat", "Barbell Front Squat", 7, "A", false],
  ["Squat", "Barbell Back Squat", 8, "A", false],
  ["Squat", "Sissy Squat", 8, "C", false],
  ["Squat", "Bodyweight Reverse Lunge", 1, "C", true],
  ["Squat", "Step Up", 2, "C", true],
  ["Squat", "Goblet Cossack Squat", 4, "C", true],
  ["Squat", "Dumbbell Split Squat", 4, "B", true],
  ["Squat", "Dumbbell Reverse Lunge", 5, "B", true],
  ["Squat", "Dumbbell Walking Lunge", 5, "B", true],
  ["Squat", "Bulgarian Split Squat", 6, "A", true],
  ["Squat", "Barbell Front Rack Walking Lunge", 8, "B", true],
  ["Squat", "Barbell Rear Foot Elevated Split Squat", 8, "A", true],
  // Hinge
  ["Hinge", "Glute Bridge", 0, "C", false],
  ["Hinge", "Lying Leg Curl", 1, "C", false],
  ["Hinge", "Kettlebell Deadlift", 2, "B", false],
  ["Hinge", "Kettlebell Swing", 3, "B", false],
  ["Hinge", "Hip Thrust", 3, "B", false],
  ["Hinge", "Dumbbell Romanian Deadlift", 4, "B", false],
  ["Hinge", "Glute-Ham Raise", 5, "B", false],
  ["Hinge", "Trap Bar Deadlift", 6, "A", false],
  ["Hinge", "Barbell Romanian Deadlift", 6, "A", false],
  ["Hinge", "Barbell Hip Thrust", 7, "A", false],
  ["Hinge", "Conventional Deadlift", 8, "A", false],
  ["Hinge", "Nordic Hamstring Curl", 8, "C", false],
  ["Hinge", "Single-Leg Glute Bridge", 1, "C", true],
  ["Hinge", "Single-Leg Hip Thrust", 3, "B", true],
  ["Hinge", "Single Leg Romanian Deadlift", 5, "B", true],
  ["Hinge", "Barbell Single Leg Romanian Deadlift", 7, "A", true],
  // Vertical Press
  ["Vertical Press", "Pike Push-Up", 0, "C", false],
  ["Vertical Press", "Dumbbell Lateral Raise", 1, "C", false],
  ["Vertical Press", "Landmine Standing Press", 2, "B", false],
  ["Vertical Press", "Dumbbell Shoulder Press", 3, "B", false],
  ["Vertical Press", "Standing Dumbbell Press", 4, "B", false],
  ["Vertical Press", "Z Press", 5, "B", false],
  ["Vertical Press", "Barbell Overhead Press", 6, "A", false],
  ["Vertical Press", "Push Press", 7, "A", false],
  ["Vertical Press", "Single Arm Landmine Press", 2, "B", true],
  ["Vertical Press", "Seated Single Arm Dumbbell Press", 3, "B", true],
  ["Vertical Press", "Alternating Dumbbell Shoulder Press", 4, "B", true],
  // Vertical Pull
  ["Vertical Pull", "Straight Arm Pulldown", 0, "C", false],
  ["Vertical Pull", "Banded Lat Pulldown", 1, "C", false],
  ["Vertical Pull", "Band-Assisted Pull-Up", 2, "C", false],
  ["Vertical Pull", "Cable Lat Pulldown", 3, "B", false],
  ["Vertical Pull", "Neutral-Grip Pulldown", 4, "B", false],
  ["Vertical Pull", "Chin-Up", 6, "A", false],
  ["Vertical Pull", "Pull-Up", 7, "A", false],
  ["Vertical Pull", "Single Arm Band Pulldown", 1, "C", true],
  ["Vertical Pull", "Single Arm Cable Lat Pulldown", 4, "B", true],
  // Horizontal Press
  ["Horizontal Press", "Push-Up", 0, "C", false],
  ["Horizontal Press", "Hand Release Push-Up", 1, "C", false],
  ["Horizontal Press", "Cable Chest Fly", 1, "C", false],
  ["Horizontal Press", "Machine Chest Press", 2, "B", false],
  ["Horizontal Press", "Dumbbell Floor Press", 3, "B", false],
  ["Horizontal Press", "Dumbbell Bench Press", 4, "B", false],
  ["Horizontal Press", "Incline Dumbbell Bench Press", 5, "B", false],
  ["Horizontal Press", "Dip", 6, "B", false],
  ["Horizontal Press", "Barbell Bench Press", 7, "A", false],
  ["Horizontal Press", "Incline Barbell Bench Press", 8, "A", false],
  ["Horizontal Press", "Split Stance Cable Press", 3, "B", true],
  ["Horizontal Press", "Single Arm Dumbbell Bench Press", 5, "B", true],
  ["Horizontal Press", "Alternating Dumbbell Flat Bench Press", 5, "B", true],
  // Horizontal Pull
  ["Horizontal Pull", "Band Pull Apart", 0, "C", false],
  ["Horizontal Pull", "Rear Delt Fly", 1, "C", false],
  ["Horizontal Pull", "Banded Face Pull", 2, "C", false],
  ["Horizontal Pull", "Inverted Row", 3, "B", false],
  ["Horizontal Pull", "Seated Cable Row", 4, "B", false],
  ["Horizontal Pull", "Chest Supported Row", 4, "B", false],
  ["Horizontal Pull", "Landmine Row with Handle", 5, "B", false],
  ["Horizontal Pull", "Barbell Row", 7, "A", false],
  ["Horizontal Pull", "Single Arm Banded Row", 1, "C", true],
  ["Horizontal Pull", "Split Stance Cable Row", 3, "B", true],
  ["Horizontal Pull", "Dumbbell One Arm Row", 5, "B", true],
  ["Horizontal Pull", "Meadows Row (Single Arm Landmine Row)", 6, "B", true],
  ["Horizontal Pull", "Renegade Row", 6, "B", true],
  // Core: Rotation
  ["Core: Rotation", "Hinged Cable Chops", 0, "C", false],
  ["Core: Rotation", "Cable Woodchop", 1, "B", false],
  ["Core: Rotation", "Medicine Ball Rotational Throw", 2, "B", false],
  ["Core: Rotation", "Landmine Rotation", 3, "B", false],
  // Core: Anti-rotation
  ["Core: Anti-rotation", "Bird Dog", 0, "C", false],
  ["Core: Anti-rotation", "3-Point Bird Dog", 1, "C", false],
  ["Core: Anti-rotation", "Half-Kneeling Pallof Press", 2, "B", false],
  ["Core: Anti-rotation", "Pallof Press", 3, "A", false],
  ["Core: Anti-rotation", "Cable Standing Pallof Press", 4, "B", false],
  ["Core: Anti-rotation", "Extended Side Plank", 4, "C", true],
  ["Core: Anti-rotation", "Copenhagen Plank", 5, "C", true],
  // Core: Flexion
  ["Core: Flexion", "Crunch", 0, "C", false],
  ["Core: Flexion", "Sit-Up", 1, "C", false],
  ["Core: Flexion", "Hanging Knee Raise", 2, "B", false],
  ["Core: Flexion", "Hanging Leg Raise", 3, "A", false],
  ["Core: Flexion", "Hanging L-Sit Flutter Kick", 4, "C", false],
  // Core: Extension (back extension, spinal extension)
  ["Core: Extension", "Superman Back Extensions", 0, "C", false],
  ["Core: Extension", "Back Extension", 1, "B", false],
  ["Core: Extension", "Reverse Hyperextension", 2, "B", false],
  ["Core: Extension", "Weighted Back Extension", 3, "A", false],
  // Core: Stability (anti-extension)
  ["Core: Stability", "Dead Bug", 0, "C", false],
  ["Core: Stability", "Alternating Dead Bug", 1, "C", false],
  ["Core: Stability", "Plank", 2, "B", false],
  ["Core: Stability", "Hollow Body Hold", 2, "C", false],
  ["Core: Stability", "Stability Ball Stir-the-Pot", 3, "B", false],
  ["Core: Stability", "Ab Wheel Rollout", 4, "A", false],
  // Loaded Carry
  ["Loaded Carry", "Suitcase Carry", 0, "B", true],
  ["Loaded Carry", "Farmers Carry", 1, "A", false],
  ["Loaded Carry", "Trap Bar Carry", 2, "A", false],
  ["Loaded Carry", "Overhead Carry Walks", 3, "B", false],
  ["Loaded Carry", "Sandbag Bear Hug Carry", 4, "B", false],
  // Biceps
  ["Elbow Flexion (Biceps)", "Band Curl", 0, "C", false],
  ["Elbow Flexion (Biceps)", "Hammer Curl", 1, "C", false],
  ["Elbow Flexion (Biceps)", "Incline Dumbbell Curl", 2, "C", false],
  ["Elbow Flexion (Biceps)", "Preacher Curl", 3, "C", false],
  ["Elbow Flexion (Biceps)", "Dumbbell Curl", 3, "B", false],
  ["Elbow Flexion (Biceps)", "Barbell Curl", 4, "A", false],
  // Triceps
  ["Elbow Extension (Triceps)", "Bench Dip", 0, "C", false],
  ["Elbow Extension (Triceps)", "Dumbbell Overhead Tricep Extension", 1, "C", false],
  ["Elbow Extension (Triceps)", "Cable Triceps Pushdown", 2, "B", false],
  ["Elbow Extension (Triceps)", "Dumbbell Skull Crusher", 3, "C", false],
  ["Elbow Extension (Triceps)", "EZ Bar Skull Crusher", 4, "C", false],
  ["Elbow Extension (Triceps)", "Barbell Close-Grip Bench Press", 5, "A", false],
];

export const STARTER_RUNGS: StarterRung[] = ROWS.map(([pattern, exercise, rank, tier, unilateral]) => ({ pattern, exercise, rank, tier, unilateral }));

export const PATTERN_NAMES = STARTER_PATTERNS.map((p) => p.name);
export const CORE_PATTERN_NAMES = STARTER_PATTERNS.filter((p) => p.core).map((p) => p.name);

// What "Add the starter ladders" does for a coach who already has some patterns: only what is missing. Ladders they have keep every exercise as it is (an exercise already on a pattern's ladder is
// never added twice, whatever its mark). Returns the patterns to create and the rungs to add to each.
export interface ExistingPattern {
  id: string | null;
  name: string;
  exerciseNames: string[];
}

export interface StarterPlan {
  newPatterns: StarterPattern[];
  rungs: { pattern: string; rungs: StarterRung[] }[];
  ladderCount: number;
  exerciseCount: number;
}

const norm = (s: string) => s.trim().toLowerCase();

// The same exercise under another spelling counts as already there (Ron's final names are singular with the implement spelled out, but older ladders and libraries have the short forms). Each group is one
// exercise; the key also reads DB and KB as dumbbell and kettlebell and ignores hyphens, punctuation and a plural s.
const ALIAS_GROUPS: string[][] = [
  ["Barbell Back Squat", "Back Squat"],
  ["Barbell Front Squat", "Front Squat"],
  ["Barbell Box Squat", "Box Squat"],
  ["Dumbbell Split Squat", "Split Squat"],
  ["Barbell Romanian Deadlift", "Romanian Deadlift", "RDL"],
  ["Single Leg Romanian Deadlift", "DB Single-Leg RDL", "Dumbbell Single Leg Romanian Deadlift", "Single-Leg RDL"],
  ["Barbell Single Leg Romanian Deadlift", "Barbell Single-Leg RDL"],
  ["Landmine Standing Press", "Landmine Press"],
  ["Dumbbell Shoulder Press", "DB Shoulder Press"],
  ["Barbell Overhead Press", "Overhead Press", "Barbell Strict Press"],
  ["Cable Lat Pulldown", "Lat Pulldown"],
  ["Banded Face Pull", "Face Pull"],
  ["Barbell Bench Press", "Bench Press"],
  ["Dumbbell Bench Press", "DB Bench Press"],
  ["Incline Dumbbell Bench Press", "Incline DB Bench Press", "Incline Dumbbell Press"],
  ["Barbell Row", "Barbell Bent-Over Row", "Bent Over Barbell Row", "Bent-Over Barbell Row"],
  ["Dumbbell One Arm Row", "Single-Arm DB Row", "Single Arm Dumbbell Row", "One Arm Dumbbell Row"],
  ["Plank", "Front Plank"],
  ["Suitcase Carry", "Single-Arm KB Carry", "Single Arm Farmers Carry", "Suitcase Carry (Single Arm Farmers Carry)"],
  ["Farmers Carry", "DB Farmer's Carry", "Farmer's Carry"],
  ["Dumbbell Curl", "DB Curl"],
  ["Incline Dumbbell Curl", "Incline DB Curl"],
  ["Dumbbell Overhead Tricep Extension", "Overhead DB Tricep Extension", "Overhead Dumbbell Tricep Extension"],
  ["Cable Triceps Pushdown", "Cable Tricep Pushdown", "Tricep Pushdown"],
  ["Barbell Close-Grip Bench Press", "Close-Grip Bench Press"],
  ["Kettlebell Swing", "Russian Kettlebell Swing"],
  ["Leg Extension", "Leg Extension Machine"],
  ["Step Up", "Step-Up"],
];

export function nameKey(name: string): string {
  return norm(name)
    .replace(/\bdb\b/g, "dumbbell")
    .replace(/\bkb\b/g, "kettlebell")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

const GROUP_BY_KEY = new Map<string, number>();
ALIAS_GROUPS.forEach((group, i) => group.forEach((n) => GROUP_BY_KEY.set(nameKey(n), i)));

// The identity of an exercise for "is it already there": its alias group when it has one, otherwise its own key.
export function exerciseIdentity(name: string): string {
  const k = nameKey(name);
  const g = GROUP_BY_KEY.get(k);
  return g === undefined ? k : `group:${g}`;
}

export function planStarterAdd(existing: ExistingPattern[]): StarterPlan {
  const byName = new Map(existing.map((p) => [norm(p.name), p]));
  const newPatterns: StarterPattern[] = [];
  const rungs: StarterPlan["rungs"] = [];
  let exerciseCount = 0;
  const touched = new Set<string>();
  for (const sp of STARTER_PATTERNS) {
    const have = byName.get(norm(sp.name));
    if (!have) newPatterns.push(sp);
    const haveNames = new Set((have?.exerciseNames ?? []).map(exerciseIdentity));
    const missing = STARTER_RUNGS.filter((r) => r.pattern === sp.name && !haveNames.has(exerciseIdentity(r.exercise)));
    if (missing.length > 0) {
      rungs.push({ pattern: sp.name, rungs: missing });
      exerciseCount += missing.length;
      touched.add(sp.name);
    }
  }
  return { newPatterns, rungs, ladderCount: touched.size, exerciseCount };
}

// The result line shown after the button is tapped.
export function starterResultLine(plan: StarterPlan): string {
  if (plan.exerciseCount === 0) return "You already have all the starter ladders.";
  return `Added ${plan.ladderCount} ${plan.ladderCount === 1 ? "ladder" : "ladders"} and ${plan.exerciseCount} ${plan.exerciseCount === 1 ? "exercise" : "exercises"}.`;
}

// The rows to insert for a plan, once every pattern has an id. A ladder the coach already had keeps its order: the added exercises go after the last one, in starter order. A new ladder uses the starter order.
export interface RungInsert {
  movement_pattern_id: string;
  exercise_name: string;
  difficulty_rank: number;
  tier: Tier;
  is_unilateral: boolean;
}

export function buildRungInserts(plan: StarterPlan, patternIdByName: Map<string, string>, maxRankByPattern: Map<string, number>): RungInsert[] {
  const out: RungInsert[] = [];
  for (const group of plan.rungs) {
    const id = patternIdByName.get(group.pattern);
    if (!id) continue;
    const base = maxRankByPattern.has(group.pattern) ? (maxRankByPattern.get(group.pattern) as number) + 1 : 0;
    const ordered = [...group.rungs].sort((a, b) => a.rank - b.rank);
    ordered.forEach((r, i) => {
      out.push({
        movement_pattern_id: id,
        exercise_name: r.exercise,
        difficulty_rank: maxRankByPattern.has(group.pattern) ? base + i : r.rank,
        tier: r.tier,
        is_unilateral: r.unilateral,
      });
    });
  }
  return out;
}
