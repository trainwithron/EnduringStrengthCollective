import type { TrackedField } from "./exercise-fields";

export type MemberRole = "coach" | "athlete";

export interface RosterMember {
  profileId: string;
  fullName: string;
  avatarUrl: string | null;
  role: MemberRole;
  lastWorkoutAt: string | null; // ISO timestamp, null = never logged
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
  } | null;
  reactionCount: number;
  viewerHasReacted: boolean;
  commentCount: number;
}
