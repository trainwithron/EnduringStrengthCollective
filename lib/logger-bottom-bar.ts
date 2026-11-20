import { restForSet, type RestForSet } from "@/lib/rest-time";
import type { SetLogEntry } from "@/lib/types";

// The workout's bottom bar (Look Refresh, client step, Ron Nov 20): "Rest {n}s" on the left and "Next: {exercise}" on the right.

type BarSet = Pick<SetLogEntry, "id" | "setOrder" | "status" | "targetRestSeconds" | "restSeconds"> & { targetRestMaxSeconds?: number | null };
type BarExercise = { id: string; sets: BarSet[] };

/** Where Next goes from the exercise on screen. In a superset or circuit it is the next exercise of the block that still has a set to do (one set of each in turn, the same order as after a
 *  set); once the whole block is done, the exercise after the block. Otherwise simply the next exercise. Null on the last one. */
export function nextExerciseId(exercises: BarExercise[], activeIndex: number, blockMembers: string[] | null): string | null {
  const active = exercises[activeIndex];
  if (!active) return null;
  if (blockMembers && blockMembers.length > 1) {
    const at = blockMembers.indexOf(active.id);
    for (let k = 1; k < blockMembers.length; k++) {
      const id = blockMembers[(at + k) % blockMembers.length];
      const ex = exercises.find((e) => e.id === id);
      if (ex && ex.sets.some((s) => s.status === "pending")) return id;
    }
    const lastIndex = Math.max(...blockMembers.map((id) => exercises.findIndex((e) => e.id === id)));
    return exercises[lastIndex + 1]?.id ?? null;
  }
  return exercises[activeIndex + 1]?.id ?? null;
}

/** The rest the Rest button starts: the coach's rest for the next set to do (or the last set), else a rest the client typed there, else 90 seconds. */
export function barRest(sets: BarExercise["sets"]): { seconds: number; rest: RestForSet | null } {
  const target = sets.find((s) => s.status === "pending") ?? sets[sets.length - 1];
  const rest = target ? restForSet(sets, target.id) : null;
  if (rest?.source === "coach") return { seconds: rest.maxSeconds ?? rest.seconds, rest };
  if (rest) return { seconds: rest.seconds, rest };
  return { seconds: 90, rest: null };
}
