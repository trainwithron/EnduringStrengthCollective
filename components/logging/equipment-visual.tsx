"use client";

import { useEffect, useRef, useState } from "react";
import type { SetLogEntry } from "@/lib/types";
import type { EquipmentType } from "@/lib/equipment-classifier";
import { computePlateBreakdown, isPlateMathMilestone, STANDARD_BAR_WEIGHT_LBS } from "@/lib/plate-math";

// Phase 3 of the gamified-logging thread (custom_shape_theming_idea.md)
// — a per-exercise visual, intuitive to what equipment it actually uses,
// rather than one fixed shape applied everywhere. Three tiers, kept
// distinct per the spec:
//   1. Per-set confirm — a one-shot pop on `justConfirmedSetId`, cleared
//      by the caller after ~900ms (same pattern as the obstacle-unlock
//      mechanic's own one-shot `justUnlocked` state).
//   2. Per-exercise progressive — the thin fill bar below the badge,
//      continuously a function of (sets completed / total sets).
//   3. Whole-workout completion — untouched, already shipped elsewhere
//      (the share card / PR confetti).
// Deliberately a header-level badge, not a per-cell clip-path on the
// weight input itself — the "does a custom shape still fit readable
// numeric text" tension flagged in the original brainstorm is real and
// unsolved; this reads the same information without risking the actual
// input's legibility.

export function EquipmentVisual({
  equipmentType,
  sets,
  justConfirmedSetId,
}: {
  equipmentType?: EquipmentType | null;
  sets: SetLogEntry[];
  justConfirmedSetId?: string | null;
}) {
  const completedSets = sets.filter((s) => s.status === "completed");
  const totalCount = sets.length;
  const completedCount = completedSets.length;
  const progressRatio = totalCount > 0 ? completedCount / totalCount : 0;

  // Most recently confirmed weight — falls back to the heaviest
  // completed weight so reopening an in-progress exercise still shows
  // something meaningful, not just a blank badge.
  // Deliberately not gated on the set being fully "completed" — a
  // multi-field exercise (weight + reps) would otherwise show nothing
  // between confirming the weight and finishing the rest of that set's
  // fields, which is exactly the common case. Any real logged weight,
  // regardless of that set's status, is what's genuinely "on the bar."
  const justConfirmedSet = justConfirmedSetId ? sets.find((s) => s.id === justConfirmedSetId) : null;
  const displayWeight =
    justConfirmedSet?.weight ??
    sets.reduce<number | null>((max, s) => {
      if (s.weight == null) return max;
      return max == null || s.weight > max ? s.weight : max;
    }, null);

  const [popping, setPopping] = useState(false);
  useEffect(() => {
    if (!justConfirmedSetId) return;
    setPopping(true);
    const t = setTimeout(() => setPopping(false), 700);
    return () => clearTimeout(t);
  }, [justConfirmedSetId]);

  // Finale — fires exactly once, the moment every set in this exercise
  // is done, never on an already-complete initial render (matches the
  // obstacle-unlock mechanic's own "one-shot, not on initial render"
  // discipline).
  const [finale, setFinale] = useState(false);
  const wasFullyDone = useRef(progressRatio >= 1 && totalCount > 0);
  useEffect(() => {
    const fullyDone = progressRatio >= 1 && totalCount > 0;
    if (fullyDone && !wasFullyDone.current) {
      setFinale(true);
      const t = setTimeout(() => setFinale(false), 1000);
      wasFullyDone.current = fullyDone;
      return () => clearTimeout(t);
    }
    wasFullyDone.current = fullyDone;
  }, [progressRatio, totalCount]);

  // Machine/cable/band/bodyweight/unset equipment has no obvious
  // "intuitive" physical loading metaphor the way free weights do —
  // deliberately renders nothing rather than forcing a decorative shape
  // that doesn't map to anything real.
  if (!equipmentType || equipmentType === "machine" || equipmentType === "cable" ||
    equipmentType === "band" || equipmentType === "bodyweight") {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mb-2" aria-hidden="true">
      {equipmentType === "barbell" && (
        <BarbellVisual weight={displayWeight} popping={popping} finale={finale} />
      )}
      {equipmentType === "kettlebell" && (
        <KettlebellVisual weight={displayWeight} popping={popping} finale={finale} />
      )}
      {equipmentType === "dumbbell" && (
        <DumbbellVisual weight={displayWeight} popping={popping} finale={finale} />
      )}
      {totalCount > 0 && (
        <div className="flex-1 h-1.5 bg-surface border border-steel/20 overflow-hidden">
          <div
            className={`h-full bg-rust transition-[width] duration-500 ease-out ${
              finale ? "animate-[equipment-finale-flash_1s_ease-out]" : ""
            }`}
            style={{ width: `${Math.round(progressRatio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BarbellVisual({
  weight,
  popping,
  finale,
}: {
  weight: number | null;
  popping: boolean;
  finale: boolean;
}) {
  if (weight == null) return <BarbellIcon perSide={[]} className="text-steel/40" />;
  const breakdown = computePlateBreakdown(weight);
  const isMilestone = isPlateMathMilestone(weight);
  return (
    <div
      className={`flex items-center gap-1.5 ${
        popping && isMilestone ? "animate-[equipment-pop_0.6s_ease-out]" : popping ? "animate-[equipment-pop-subtle_0.4s_ease-out]" : ""
      } ${finale ? "animate-[equipment-finale-flash_1s_ease-out]" : ""}`}
    >
      <BarbellIcon perSide={breakdown.perSide} className={isMilestone ? "text-rust" : "text-chalk"} />
      <span className="font-display text-sm">
        {weight}
        <span className="font-body text-[10px] text-steel ml-0.5">lbs</span>
      </span>
      {breakdown.exact && breakdown.perSide.length > 0 && (
        <span className="font-body text-[10px] text-steel">
          ({breakdown.perSide.join("/")} per side)
        </span>
      )}
      {weight < STANDARD_BAR_WEIGHT_LBS && (
        <span className="font-body text-[10px] text-steel">under bar weight</span>
      )}
    </div>
  );
}

function BarbellIcon({ perSide, className }: { perSide: number[]; className: string }) {
  // Simple, legible bar-with-plates glyph — plate count/size isn't drawn
  // to exact scale (would get cluttered past 2-3 plates), just enough
  // visible plates to read as "loaded" once any exist.
  const plateCount = Math.min(perSide.length, 3);
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" className={`shrink-0 ${className}`}>
      <rect x="0" y="7" width="28" height="2" fill="currentColor" />
      {Array.from({ length: plateCount }).map((_, i) => (
        <rect key={`l${i}`} x={2 + i * 2.5} y={2} width="2" height="12" fill="currentColor" />
      ))}
      {Array.from({ length: plateCount }).map((_, i) => (
        <rect key={`r${i}`} x={26 - 2 - i * 2.5} y={2} width="2" height="12" fill="currentColor" />
      ))}
    </svg>
  );
}

function KettlebellVisual({
  weight,
  popping,
  finale,
}: {
  weight: number | null;
  popping: boolean;
  finale: boolean;
}) {
  // "One object gets bigger" mental model — scaled by sqrt so the visual
  // area (not just linear size) tracks weight, clamped to a sane range so
  // a 100 lb kettlebell doesn't blow out the layout.
  const size = weight == null ? 18 : Math.min(40, Math.max(18, Math.round(Math.sqrt(weight) * 3.6)));
  return (
    <div
      className={`flex items-center gap-1.5 ${
        popping ? "animate-[equipment-pop_0.6s_ease-out]" : ""
      } ${finale ? "animate-[equipment-finale-flash_1s_ease-out]" : ""}`}
    >
      <div
        className="rounded-full bg-steel/20 border-2 border-chalk flex items-center justify-center shrink-0 transition-[width,height] duration-500 ease-out"
        style={{ width: size, height: size }}
      >
        <div className="w-[35%] h-[18%] bg-chalk rounded-full -mt-[60%]" />
      </div>
      {weight != null && (
        <span className="font-display text-sm">
          {weight}
          <span className="font-body text-[10px] text-steel ml-0.5">lbs</span>
        </span>
      )}
    </div>
  );
}

function DumbbellVisual({
  weight,
  popping,
  finale,
}: {
  weight: number | null;
  popping: boolean;
  finale: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${
        popping ? "animate-[equipment-pop_0.6s_ease-out]" : ""
      } ${finale ? "animate-[equipment-finale-flash_1s_ease-out]" : ""}`}
    >
      <svg width="30" height="16" viewBox="0 0 30 16" className="shrink-0 text-chalk">
        <rect x="13" y="6" width="4" height="4" fill="currentColor" />
        <rect x="0" y="3" width="6" height="10" rx="1" fill="currentColor" />
        <rect x="24" y="3" width="6" height="10" rx="1" fill="currentColor" />
      </svg>
      {/* The number "on the side of the head" — matches a real dumbbell's
          own printed-weight convention. */}
      <span className="font-display text-sm">
        {weight ?? "—"}
        <span className="font-body text-[10px] text-steel ml-0.5">lbs</span>
      </span>
    </div>
  );
}
