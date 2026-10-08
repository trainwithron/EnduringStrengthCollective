// A short, honest summary of what an exercise prescribes (pure): "3x10", "3x10 @ 50 lb", "3x60s", "3x8-10", "10/8/6 @ 135 lb". Used on the collapsed builder card and in the "Preview as my
// client sees it" sheet, so a built day can be read at a glance.

import type { TrackedField } from "@/lib/exercise-fields";
import type { ExerciseSetTarget } from "@/lib/types";

type SummarySet = Pick<ExerciseSetTarget, "targetReps" | "targetWeight" | "targetTimeSeconds" | "targetDistance" | "targetHeight" | "targetRestSeconds"> &
  Partial<Pick<ExerciseSetTarget, "targetRpe" | "targetRir" | "targetTempo" | "targetPace">>;

const numberOf = (text: string | null): number | null => {
  if (text == null) return null;
  const t = text.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function clean(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// The values of one field across the sets, as the summary part: one value when they all match, a slash list when there are few and they step in one direction ("10/8/6"), else a range
// ("8-10"). Text values (an "AMRAP", a "8-12" typed range) that differ are listed as typed.
function valuesPart(values: string[]): string {
  const distinct = Array.from(new Set(values));
  if (distinct.length === 1) return distinct[0];
  const nums = values.map((v) => numberOf(v));
  if (nums.every((n) => n != null)) {
    const ns = nums as number[];
    const steps = ns.slice(1).map((n, i) => n - ns[i]);
    const monotonic = steps.every((s) => s >= 0) || steps.every((s) => s <= 0);
    if (monotonic && ns.length <= 5) return ns.map(clean).join("/");
    return `${clean(Math.min(...ns))}-${clean(Math.max(...ns))}`;
  }
  return distinct.join("/");
}

function primary(sets: SummarySet[], tracked: TrackedField[]): { values: string[]; suffix: string } | null {
  if (tracked.includes("reps")) {
    const v = sets.map((s) => s.targetReps?.trim() || "").filter(Boolean);
    if (v.length === sets.length && v.length > 0) return { values: v, suffix: "" };
  }
  if (tracked.includes("time")) {
    const v = sets.map((s) => (s.targetTimeSeconds != null ? clean(s.targetTimeSeconds) : "")).filter(Boolean);
    if (v.length === sets.length && v.length > 0) return { values: v, suffix: "s" };
  }
  if (tracked.includes("distance")) {
    const v = sets.map((s) => (s.targetDistance != null ? clean(s.targetDistance) : "")).filter(Boolean);
    if (v.length === sets.length && v.length > 0) return { values: v, suffix: "" };
  }
  if (tracked.includes("height")) {
    const v = sets.map((s) => (s.targetHeight != null ? clean(s.targetHeight) : "")).filter(Boolean);
    if (v.length === sets.length && v.length > 0) return { values: v, suffix: "" };
  }
  return null;
}

const rangeOf = (ns: number[]): string => {
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  return lo === hi ? clean(lo) : `${clean(lo)}-${clean(hi)}`;
};

export interface SummaryOptions {
  // Adds the rest ("rest 90s") when the sets carry one: the client preview shows it, the compact collapsed card does not.
  withRest?: boolean;
  // Adds the effort and style the sets carry (RPE, RIR, tempo, pace), for the client preview; the compact collapsed card leaves them out.
  withExtras?: boolean;
  weightUnit?: "lb" | "kg";
}

export function summarizeSets(sets: SummarySet[], tracked: TrackedField[], options: SummaryOptions = {}): string {
  const n = sets.length;
  if (n === 0) return "no sets yet";
  const unit = options.weightUnit ?? "lb";
  const main = primary(sets, tracked);

  let text: string;
  if (!main) {
    text = `${n} ${n === 1 ? "set" : "sets"}`;
  } else {
    const part = valuesPart(main.values);
    const differs = new Set(main.values).size > 1;
    // sets of different values in a short list read as one line ("10/8/6"), uniform ones as "3x10"
    text = differs && part.includes("/") && !part.includes("-") ? `${part}${main.suffix}` : `${n}x${part}${main.suffix}`;
  }

  if (tracked.includes("weight")) {
    const w = sets.map((s) => s.targetWeight).filter((x): x is number => x != null && x > 0);
    if (w.length > 0) {
      const lo = Math.min(...w);
      const hi = Math.max(...w);
      text += lo === hi ? ` @ ${clean(lo)} ${unit}` : ` @ ${clean(lo)}-${clean(hi)} ${unit}`;
    }
  }

  if (options.withExtras) {
    const rpe = sets.map((x) => x.targetRpe).filter((v): v is number => v != null);
    if (tracked.includes("rpe") && rpe.length === n) text += ` · RPE ${rangeOf(rpe)}`;
    const rir = sets.map((x) => x.targetRir).filter((v): v is number => v != null);
    if (tracked.includes("rir") && rir.length === n) text += ` · RIR ${rangeOf(rir)}`;
    const tempo = sets.map((x) => x.targetTempo?.trim() ?? "").filter(Boolean);
    if (tracked.includes("tempo") && tempo.length === n) text += ` · tempo ${Array.from(new Set(tempo)).join(" / ")}`;
    const pace = sets.map((x) => x.targetPace?.trim() ?? "").filter(Boolean);
    if (tracked.includes("pace") && pace.length === n) text += ` · pace ${Array.from(new Set(pace)).join(" / ")}`;
  }

  if (options.withRest && tracked.includes("rest")) {
    const r = sets.map((s) => s.targetRestSeconds).filter((x): x is number => x != null && x > 0);
    if (r.length > 0) {
      const lo = Math.min(...r);
      const hi = Math.max(...r);
      text += lo === hi ? ` · rest ${clean(lo)}s` : ` · rest ${clean(lo)}-${clean(hi)}s`;
    }
  }
  return text;
}
