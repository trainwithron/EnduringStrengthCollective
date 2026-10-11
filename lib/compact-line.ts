// The one line an exercise takes in the builder's compact view: sets x reps ("3x8", "4x6-8"), the weight only when there is one ("4x8 @135"), a timed set as m:ss ("20:00",
// or "3x1:30" for several). Pure, so it can be tested; the prescription is read from the first set unless the sets differ, in which case the values are listed ("8/6/6").
import type { TrackedField } from "@/lib/exercise-fields";

interface CompactSet {
  targetReps: string | null;
  targetWeight: number | null;
  targetTimeSeconds: number | null;
  targetDistance: number | null;
  repMin?: number | null;
  repMax?: number | null;
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function repsOf(s: CompactSet): string | null {
  const text = (s.targetReps ?? "").trim();
  if (text) return text.replace(/\s*[-–]\s*/g, "-");
  if (s.repMin != null && s.repMax != null) return s.repMin === s.repMax ? String(s.repMin) : `${s.repMin}-${s.repMax}`;
  return null;
}

// Every set's value if they all match (shown once), otherwise the list in order ("8/6/6").
function sameOrList(values: string[]): string {
  return values.every((v) => v === values[0]) ? values[0] : values.join("/");
}

// loggedWeight: a weight the client logged, used only when nothing is prescribed.
export function formatCompactLine(sets: CompactSet[], trackedFields: TrackedField[], loggedWeight?: number | null): string {
  const count = sets.length;
  if (count === 0) return "No sets";
  const weightPrescribed = trackedFields.includes("weight") ? sets.map((s) => s.targetWeight).filter((w): w is number => w != null) : [];
  const weight = weightPrescribed.length > 0 ? sameOrList(weightPrescribed.map(String)) : loggedWeight != null && trackedFields.includes("weight") ? String(loggedWeight) : null;
  const at = weight != null ? ` @${weight}` : "";

  if (trackedFields.includes("reps")) {
    const reps = sets.map(repsOf);
    if (reps.every((r): r is string => r != null)) {
      const shown = sameOrList(reps);
      return reps.every((r) => r === reps[0]) ? `${count}x${shown}${at}` : `${shown}${at}`;
    }
  }
  if (trackedFields.includes("time")) {
    const times = sets.map((s) => s.targetTimeSeconds);
    if (times.every((t): t is number => t != null)) {
      const shown = sameOrList(times.map(clock));
      return count === 1 ? shown : times.every((t) => t === times[0]) ? `${count}x${shown}` : shown;
    }
  }
  if (trackedFields.includes("distance")) {
    const dist = sets.map((s) => s.targetDistance);
    if (dist.every((d): d is number => d != null)) {
      const shown = sameOrList(dist.map(String));
      return count === 1 ? shown : dist.every((d) => d === dist[0]) ? `${count}x${shown}` : shown;
    }
  }
  return `${count} ${count === 1 ? "set" : "sets"}${at}`;
}
