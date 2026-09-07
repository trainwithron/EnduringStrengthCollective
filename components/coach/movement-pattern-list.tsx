"use client";

import { useState } from "react";
import { MovementPatternRow, type MovementPlane } from "./movement-pattern-row";

interface PatternWithLadder {
  id: string;
  name: string;
  plane: MovementPlane;
  ladder: { key: string; exerciseName: string; tier: "A" | "B" | "C" | null }[];
}

const PLANES = ["sagittal", "frontal", "transverse"] as const;

export function MovementPatternList({
  initialPatterns,
  exerciseLibrary,
}: {
  initialPatterns: PatternWithLadder[];
  exerciseLibrary: string[];
}) {
  const [patterns, setPatterns] = useState(initialPatterns);
  const [filter, setFilter] = useState<MovementPlane>(null);

  const visible = filter ? patterns.filter((p) => p.plane === filter) : patterns;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4">
        <span className="font-body text-xs text-steel uppercase tracking-wide mr-1">
          Filter by plane
        </span>
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={`h-7 px-2.5 border font-body text-xs transition-colors ${
            filter === null
              ? "bg-rust border-rust text-graphite"
              : "border-steel/30 text-steel active:border-rust active:text-rust"
          }`}
        >
          All
        </button>
        {PLANES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setFilter((prev) => (prev === p ? null : p))}
            className={`h-7 px-2.5 border font-body text-xs capitalize transition-colors ${
              filter === p
                ? "bg-rust border-rust text-graphite"
                : "border-steel/30 text-steel active:border-rust active:text-rust"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">
          No patterns tagged with this plane yet.
        </p>
      ) : (
        <div className="divide-y divide-steel/15">
          {visible.map((p) => (
            <MovementPatternRow
              key={p.id}
              pattern={{ id: p.id, name: p.name }}
              initialLadder={p.ladder}
              exerciseLibrary={exerciseLibrary}
              plane={p.plane}
              onPlaneChange={(plane) =>
                setPatterns((prev) => prev.map((pp) => (pp.id === p.id ? { ...pp, plane } : pp)))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
