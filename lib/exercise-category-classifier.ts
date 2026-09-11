// Keyword-based suggestion for exercise_library.category (the same 7
// values the Exercise Library page already uses — see
// supabase/migrations/0031_exercise_library_category.sql). This is a
// SUGGESTION engine, never an auto-assigner: every call site that uses
// it must let the coach confirm or override before anything is written.
//
// Matching is substring-anywhere, not whole-word/first-token — a coach's
// real exercise names carry a lot of modifiers ("Ipsilateral Split
// Stance Overhead Lunge with Kettlebell", "Tempo 3-1-1 Barbell Back
// Squat"), and the category should resolve off the core movement word
// no matter where it sits in the name or how much else surrounds it.

export type ExerciseCategory = "Push" | "Pull" | "Legs" | "Core" | "Full Body" | "Cardio" | "Mobility";

interface KeywordRule {
  keyword: string;
  category: ExerciseCategory;
}

// One flat list, checked top to bottom — the FIRST matching keyword
// wins. Ordered by specificity, most specific first, not grouped
// strictly by category, because a more specific phrase must always beat
// a more generic word that happens to also appear in the name:
//   - "Leg Press" must match "leg press" (Legs) before the generic
//     "press" (Push) rule ever gets a chance to fire.
//   - "Rowing Machine" must match "rowing machine" (Cardio) before the
//     generic "row" (Pull) rule fires.
//   - "Overhead Lunge" must match "lunge" (Legs) — "overhead" alone is
//     deliberately NOT a keyword anywhere, since by itself it's equally
//     consistent with a press, a squat, or a carry and would just guess
//     wrong as often as right.
const KEYWORD_RULES: KeywordRule[] = [
  // ---- Multi-word / highly specific phrases first, across every category ----
  { keyword: "leg press", category: "Legs" },
  { keyword: "leg curl", category: "Legs" },
  { keyword: "leg extension", category: "Legs" },
  { keyword: "hip thrust", category: "Legs" },
  { keyword: "step-up", category: "Legs" },
  { keyword: "step up", category: "Legs" },
  { keyword: "calf raise", category: "Legs" },
  { keyword: "glute bridge", category: "Legs" },
  { keyword: "goblet squat", category: "Legs" },

  { keyword: "pull-up", category: "Pull" },
  { keyword: "pull up", category: "Pull" },
  { keyword: "pullup", category: "Pull" },
  { keyword: "chin-up", category: "Pull" },
  { keyword: "chin up", category: "Pull" },
  { keyword: "chinup", category: "Pull" },
  { keyword: "lat pulldown", category: "Pull" },
  { keyword: "pulldown", category: "Pull" },
  { keyword: "face pull", category: "Pull" },
  { keyword: "band pull-apart", category: "Pull" },
  { keyword: "pull-apart", category: "Pull" },
  { keyword: "bicep curl", category: "Pull" },

  { keyword: "bench press", category: "Push" },
  { keyword: "chest press", category: "Push" },
  { keyword: "chest fly", category: "Push" },
  { keyword: "overhead press", category: "Push" },
  { keyword: "shoulder press", category: "Push" },
  { keyword: "military press", category: "Push" },
  { keyword: "push-up", category: "Push" },
  { keyword: "push up", category: "Push" },
  { keyword: "pushup", category: "Push" },
  { keyword: "tricep extension", category: "Push" },
  { keyword: "skull crusher", category: "Push" },
  { keyword: "lateral raise", category: "Push" },
  { keyword: "front raise", category: "Push" },

  { keyword: "sit-up", category: "Core" },
  { keyword: "sit up", category: "Core" },
  { keyword: "situp", category: "Core" },
  { keyword: "russian twist", category: "Core" },
  { keyword: "leg raise", category: "Core" },
  { keyword: "hollow hold", category: "Core" },
  { keyword: "dead bug", category: "Core" },
  { keyword: "ab wheel", category: "Core" },
  { keyword: "ab rollout", category: "Core" },
  { keyword: "mountain climber", category: "Core" },
  { keyword: "wood chop", category: "Core" },
  { keyword: "woodchop", category: "Core" },

  { keyword: "rowing machine", category: "Cardio" },
  { keyword: "row erg", category: "Cardio" },
  { keyword: "indoor row", category: "Cardio" },
  { keyword: "jump rope", category: "Cardio" },
  { keyword: "jumping jack", category: "Cardio" },
  { keyword: "battle rope", category: "Cardio" },
  { keyword: "assault bike", category: "Cardio" },
  { keyword: "stair climber", category: "Cardio" },
  { keyword: "high knee", category: "Cardio" },

  { keyword: "foam roll", category: "Mobility" },
  { keyword: "cat-cow", category: "Mobility" },
  { keyword: "cat cow", category: "Mobility" },
  { keyword: "hip circle", category: "Mobility" },
  { keyword: "world's greatest stretch", category: "Mobility" },
  { keyword: "dynamic warm", category: "Mobility" },
  { keyword: "band walk", category: "Mobility" },
  // "___ Stretch" for a specific body part must resolve to Mobility, not
  // to that part's usual strength-training category — listed here,
  // ahead of the single-word "hamstring"/"quad"/"glute"/"calf" (Legs)
  // rules further down, so e.g. "Hamstring Stretch" doesn't get
  // misfiled as a Legs strength exercise.
  { keyword: "hamstring stretch", category: "Mobility" },
  { keyword: "quad stretch", category: "Mobility" },
  { keyword: "calf stretch", category: "Mobility" },
  { keyword: "glute stretch", category: "Mobility" },
  { keyword: "hip stretch", category: "Mobility" },
  { keyword: "shoulder stretch", category: "Mobility" },
  { keyword: "chest stretch", category: "Mobility" },

  { keyword: "clean and jerk", category: "Full Body" },
  { keyword: "turkish get-up", category: "Full Body" },
  { keyword: "turkish get up", category: "Full Body" },
  { keyword: "get-up", category: "Full Body" },
  { keyword: "farmer's carry", category: "Full Body" },
  { keyword: "farmers carry", category: "Full Body" },
  { keyword: "man maker", category: "Full Body" },
  { keyword: "wall ball", category: "Full Body" },
  { keyword: "full body", category: "Full Body" },

  // ---- Single, still-decisive movement nouns ----
  // Deadlift is a judgment call, documented here rather than left
  // implicit: traditional bodybuilding "push/pull/legs" splits often
  // file deadlifts under "pull day" (it IS a pulling motion off the
  // floor). But THIS app's own Push/Pull/Legs mapping (see
  // lib/program-card-visuals.ts's bucketCategorySplit: Push+Pull ->
  // Upper, Legs -> Lower) treats "Pull" as an upper-body bucket and
  // "Legs" as the lower-body one — and a deadlift's actual training
  // stress (hamstrings/glutes/lower back) is a lower-body/posterior-
  // chain load, not an upper-body one. Filing it under "Pull" would
  // silently under-count a program's real lower-body volume. So
  // deadlift (and every variant — Romanian, Sumo, Stiff-Leg, all match
  // via this one substring) resolves to Legs here, matching this app's
  // own volume-split convention over the generic gym-culture label.
  { keyword: "deadlift", category: "Legs" },
  { keyword: "squat", category: "Legs" },
  { keyword: "lunge", category: "Legs" },
  { keyword: "hamstring", category: "Legs" },
  { keyword: "quad", category: "Legs" },
  { keyword: "glute", category: "Legs" },
  { keyword: "calf", category: "Legs" },

  { keyword: "row", category: "Pull" },
  { keyword: "curl", category: "Pull" },
  { keyword: "shrug", category: "Pull" },
  { keyword: "reverse fly", category: "Pull" },
  // Deliberately no bare "lat" keyword — too short/aggressive a
  // substring (matches inside "later", "relate", "alternate",
  // "flatten"...) and "Lat Raise" (a real shoulder exercise, a synonym
  // for Lateral Raise) would wrongly resolve to Pull via it before ever
  // reaching the "raise" rule below. "lat pulldown"/"lat pull" above
  // already cover the genuine Pull case.

  { keyword: "press", category: "Push" },
  { keyword: "fly", category: "Push" },
  { keyword: "dip", category: "Push" },
  { keyword: "tricep", category: "Push" },
  { keyword: "extension", category: "Push" },
  { keyword: "raise", category: "Push" },

  { keyword: "plank", category: "Core" },
  { keyword: "crunch", category: "Core" },
  { keyword: "abs", category: "Core" },
  { keyword: "core", category: "Core" },

  { keyword: "sprint", category: "Cardio" },
  { keyword: "burpee", category: "Cardio" },
  { keyword: "sled", category: "Cardio" },
  { keyword: "bike", category: "Cardio" },
  { keyword: "cycling", category: "Cardio" },
  { keyword: "elliptical", category: "Cardio" },
  { keyword: "jog", category: "Cardio" },
  { keyword: "run", category: "Cardio" },

  { keyword: "stretch", category: "Mobility" },
  { keyword: "mobility", category: "Mobility" },
  { keyword: "yoga", category: "Mobility" },

  { keyword: "clean", category: "Full Body" },
  { keyword: "snatch", category: "Full Body" },
  { keyword: "thruster", category: "Full Body" },
  { keyword: "carry", category: "Full Body" },
  { keyword: "complex", category: "Full Body" },
];

export function classifyExerciseCategory(name: string): ExerciseCategory | null {
  const normalized = name.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (normalized.includes(rule.keyword)) return rule.category;
  }
  return null;
}
