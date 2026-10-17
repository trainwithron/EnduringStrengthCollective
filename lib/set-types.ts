// What kind of set a logged set is. Warm-up and drop sets are shown and counted as work done, but they never move a progression, a record or a training max: a warm-up of 135 must not look like a PR
// and a drop set to failure must not look like a failed working set.
export const SET_TYPES = ["warmup", "working", "amrap", "backoff", "drop"] as const;
export type SetType = (typeof SET_TYPES)[number];

export const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: "Warm-up",
  working: "Working set",
  amrap: "As many reps as possible",
  backoff: "Back-off",
  drop: "Drop set",
};

export function asSetType(value: unknown): SetType {
  return (SET_TYPES as readonly string[]).includes(value as string) ? (value as SetType) : "working";
}

// The sets that count toward progression, records and training maxes.
export const COUNTED_SET_TYPES: readonly SetType[] = ["working", "amrap", "backoff"];

export function countsForProgress(type: unknown): boolean {
  return COUNTED_SET_TYPES.includes(asSetType(type));
}
