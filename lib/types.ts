import type { TrackedField } from "./exercise-fields";
import type { EquipmentType } from "./equipment-classifier";

export type MemberRole = "coach" | "athlete";

// One-on-one / online get the full feature set; "group" (low-ticket,
// large-group clients) gets a reduced set — no macro programming, since
// that's not part of what they're paying for. Null = not yet classified,
// treated the same as full-featured until a coach sets it.
export type ClientTier = "one_on_one" | "online" | "group" | null;

export interface RosterMember {
  profileId: string;
  fullName: string;
  avatarUrl: string | null;
  role: MemberRole;
  lastWorkoutAt: string | null; // ISO timestamp, null = never logged
  clientTier: ClientTier;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export type SetLogStatus = "pending" | "completed" | "skipped";

export interface SetLogEntry {
  id: string;
  setOrder: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  tempo: string | null;
  timeSeconds: number | null;
  height: number | null;
  distance: number | null;
  restSeconds: number | null;
  pace: string | null;
  status: SetLogStatus;
  // The prescribed value for each "extra" field (RPE, RIR, tempo, etc.),
  // shown only as a placeholder hint during logging — never pre-filled
  // into the real column, so a set never silently counts as "done" just
  // because a target existed. Weight/reps already pre-fill for real (a
  // coach/athlete types a genuine weight regardless of plan), so there's
  // no placeholder-hint use for these two — targetReps/targetWeight
  // exist purely for the obstacle-unlock mechanic (lib/obstacle-unlock.ts)
  // to compare an actual logged set against today's real prescribed goal.
  targetReps?: number | null;
  targetWeight?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  targetTempo?: string | null;
  targetTimeSeconds?: number | null;
  targetHeight?: number | null;
  targetDistance?: number | null;
  targetRestSeconds?: number | null;
  targetPace?: string | null;
  // Correlating-week weight suggestion (lib/set-suggestions.ts) — a
  // grayed-out placeholder in the logging UI, accepted via swipe/tap;
  // never auto-committed the way a coach-set target_weight already is.
  suggestedWeight?: number | null;
  // True once the athlete has explicitly committed a weight value this
  // set (typed it, or accepted a suggestion) — false for a program's own
  // pre-fill, which lands in this same `weight` column but was never a
  // real attempt. The obstacle-unlock mechanic (lib/obstacle-unlock.ts)
  // requires this before a set's weight/reps can ever clear the goal.
  weightConfirmed?: boolean;
}

export interface SessionExerciseEntry {
  id: string;
  exerciseName: string;
  exerciseOrder: number;
  isSwapped: boolean;
  isAdded: boolean;
  trackedFields: TrackedField[];
  videoUrl: string | null;
  youtubeUrl: string | null;
  notes: string | null;
  sets: SetLogEntry[];
  // This athlete's real all-time best (weight/reps/single-set volume) on
  // this exact exercise name, from every other completed session — the
  // obstacle-unlock mechanic's PR-path input (lib/obstacle-unlock.ts).
  // Optional/undefined on any render path that doesn't compute it (the
  // coach's own program-builder preview, etc.).
  priorBest?: { maxWeight: number | null; maxReps: number | null; maxVolume: number | null };
  // Phase 3 of the gamified-logging thread (custom_shape_theming_idea.md)
  // — which per-set visual/animation treatment to use (barbell plate
  // math, kettlebell scaling, dumbbell number, or a generic default for
  // everything else). From the coach's exercise_library, keyed by name;
  // null/undefined when unset or unmatched — falls back to the generic
  // treatment, never blocks logging either way.
  equipmentType?: EquipmentType | null;
}

// ----------------------------------------------------------------------------
// Coach's inline program builder (day columns / exercise cards)
// ----------------------------------------------------------------------------

export interface ExerciseSetTarget {
  id: string;
  setOrder: number;
  targetReps: string | null;
  targetWeight: number | null;
  targetRpe: number | null;
  targetRir: number | null;
  targetTempo: string | null;
  targetTimeSeconds: number | null;
  targetHeight: number | null;
  targetDistance: number | null;
  targetRestSeconds: number | null;
  targetPace: string | null;
  // Optional structured rep range (distinct from the free-text targetReps
  // above) — only used by Double Progression to know when a set has
  // maxed out reps and should bump weight instead. Reused as a distance
  // floor/ceiling for the same purpose when an exercise tracks Distance
  // instead of Reps (see lib/progression-models.ts).
  repMin: number | null;
  repMax: number | null;
}

export interface BuilderExercise {
  kind: "exercise";
  id: string;
  order: number;
  exerciseName: string;
  movementPatternId: string | null;
  trackedFields: TrackedField[];
  notes: string | null;
  videoPath: string | null;
  youtubeUrl: string | null;
  sets: ExerciseSetTarget[];
  // Read-only here — derived from wherever this exercise sits in one of
  // the coach's movement-pattern ladders (Exercise Library), not a
  // separately-editable field. Null if the exercise isn't linked to any
  // tiered movement pattern.
  tier: "A" | "B" | "C" | null;
}

export interface BuilderNote {
  kind: "note";
  id: string;
  order: number;
  body: string;
}

export type BuilderItem = BuilderExercise | BuilderNote;

export interface BuilderDay {
  id: string; // workout id
  title: string;
  weekNumber: number;
  dayIndex: number;
  items: BuilderItem[];
}

export type FeedChannel = "announcements" | "form_checks" | "pr_board" | "general";

export interface FeedPost {
  id: string;
  groupId: string;
  postType: "user_post" | "workout_summary";
  channel: FeedChannel;
  pinnedAt: string | null;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  createdAt: string;
  author: { id: string; fullName: string; avatarUrl: string | null };
  workoutSummary: {
    totalVolume: number | null;
    totalSetsCompleted: number | null;
    newPrs: string[];
    loggedByCoach: boolean;
    broadcastLevel: "full" | "prs_only" | "checkin_only";
  } | null;
  reactionCount: number;
  viewerHasReacted: boolean;
  commentCount: number;
}
