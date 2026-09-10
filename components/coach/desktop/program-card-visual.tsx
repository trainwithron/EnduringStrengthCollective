"use client";

import { useState } from "react";
import {
  buildSparklinePath,
  type WeeklyVolumePoint,
  type CategorySplit,
} from "@/lib/program-card-visuals";

const SPARK_W = 100;
const SPARK_H = 60;

// Literal hex, not var(--token), matching the same convention already
// used by components/coach/desktop/trend-chart.tsx for SVG presentation
// attributes.
const RUST = "#C4622D";
const STEEL = "#8A8578";
const MOSS = "#6B8F71";
const BLUE = "#4A7A9E";

// Fills a program card's image slot when no cover photo is set — no
// stock photography, the visual is generated entirely from that
// program's own real data. Renders null (letting the caller fall back
// to the plain placeholder) when there's nothing to plot at all, e.g. a
// brand-new program with zero workouts built yet.
export function ProgramCardVisual({
  weeklySeries,
  categorySplit,
}: {
  weeklySeries: WeeklyVolumePoint[];
  categorySplit: CategorySplit;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (weeklySeries.length === 0) return null;

  const plannedValues = weeklySeries.map((w) => w.plannedIndexed);
  const actualValues = weeklySeries.map((w) => w.actualIndexed);
  const finite = [...plannedValues, ...actualValues.filter((v): v is number => v !== null)];
  const range = { min: Math.min(0, ...finite), max: Math.max(100, ...finite) };

  const planned = buildSparklinePath(plannedValues, SPARK_W, SPARK_H, range);
  const actual = buildSparklinePath(actualValues, SPARK_W, SPARK_H, range);

  const hovered = hoverIdx !== null ? weeklySeries[hoverIdx] : null;

  return (
    <div className="w-full h-full flex flex-col justify-end p-2 gap-1.5">
      <div
        className="flex-1 min-h-0 relative"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(relX * (weeklySeries.length - 1));
          setHoverIdx(Math.max(0, Math.min(weeklySeries.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className="w-full h-full overflow-visible"
        >
          <defs>
            <linearGradient id="programCardArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RUST} stopOpacity={0.3} />
              <stop offset="100%" stopColor={RUST} stopOpacity={0} />
            </linearGradient>
          </defs>
          {planned.areaPath && <path d={planned.areaPath} fill="url(#programCardArea)" stroke="none" />}
          <path
            d={planned.linePath}
            fill="none"
            stroke={STEEL}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={actual.linePath}
            fill="none"
            stroke={RUST}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {actual.points.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r={1.8} fill={RUST} /> : null))}
        </svg>
        {hovered && (
          <div
            className="absolute pointer-events-none bg-graphite border border-steel/30 px-1.5 py-0.5 font-body text-[10px] text-chalk whitespace-nowrap z-10"
            style={{
              left: `${(hoverIdx! / Math.max(1, weeklySeries.length - 1)) * 100}%`,
              top: 0,
              transform: "translate(-50%, -115%)",
            }}
          >
            Wk {hovered.week}
            {hovered.actualIndexed !== null ? ` · ${Math.round(hovered.actualIndexed)}%` : " · not logged"}
          </div>
        )}
      </div>

      <div>
        <div className="flex h-1 overflow-hidden bg-surface">
          <span style={{ width: `${categorySplit.upper}%`, backgroundColor: RUST }} />
          <span style={{ width: `${categorySplit.lower}%`, backgroundColor: MOSS }} />
          <span style={{ width: `${categorySplit.conditioning}%`, backgroundColor: BLUE }} />
        </div>
        <div className="flex gap-2 mt-1 font-body text-[9px] text-steel leading-none flex-wrap">
          <span>Upper {categorySplit.upper}%</span>
          <span>Lower {categorySplit.lower}%</span>
          <span>Cond. {categorySplit.conditioning}%</span>
        </div>
      </div>
    </div>
  );
}
