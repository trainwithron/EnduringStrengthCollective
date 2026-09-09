import type { TrackedField } from "./exercise-fields";

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
  status: SetLogStatus;
  // The prescribed value for each "extra" field (RPE, RIR, tempo, etc.),
  // shown only as a placeholder hint during logging — never pre-filled
  // into the real column, so a set never silently counts as "done" just
  // because a target existed. Weight/reps aren't included here since
  // those already pre-fill for real (a coach/athlete types a genuine
  // weight regardless of plan, so there's no meaningful "leave it
  // unsubmitted" state for them the way there is for RPE/RIR/etc.).
  targetRpe?: number | null;
  targetRir?: number | null;
  targetTempo?: string | null;
  targetTimeSeconds?: number | null;
  targetHeight?: number | null;
  targetDistance?: number | null;
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
  // Optional structured rep range (distinct from the free-text targetReps
  // above) — only used by Double Progression to know when a set has
  // maxed out reps and should bump weight instead.
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
