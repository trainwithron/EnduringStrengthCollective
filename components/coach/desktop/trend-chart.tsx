"use client";

import { computeChartGeometry, type TrendPoint } from "@/lib/trend-chart-math";

const WIDTH = 560;
const HEIGHT = 140;
const PADDING = 28;

// Hand-rolled SVG line chart — no charting library, matching how this app
// already avoids dependencies for small visual pieces (e.g. the PR burst
// animation, the icon generator). Draws the real data as a solid line and
// a least-squares best-fit as a dashed one, so day-to-day noise doesn't
// hide whether the overall direction is up or down.
export function TrendChart({
  points,
  unit,
  emptyLabel = "Not enough data yet — needs at least 2 points.",
}: {
  points: TrendPoint[];
  unit?: string;
  emptyLabel?: string;
}) {
  const geometry = computeChartGeometry(points, WIDTH, HEIGHT, PADDING);

  if (!geometry) {
    return <p className="font-body text-sm text-steel py-4">{emptyLabel}</p>;
  }

  const { points: plotted, trendLine, minValue, maxValue } = geometry;
  const linePath = plotted.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const delta = last.value - first.value;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Trend from ${first.value}${unit ?? ""} to ${last.value}${unit ?? ""}`}
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          stroke="#3A362F"
          strokeWidth={1}
        />
        <line
          x1={trendLine.x1}
          y1={trendLine.y1}
          x2={trendLine.x2}
          y2={trendLine.y2}
          stroke="#8A8168"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <path d={linePath} fill="none" stroke="#D2703B" strokeWidth={2} />
        {plotted.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === plotted.length - 1 ? 3.5 : 2.5} fill="#D2703B" />
        ))}
        <text x={PADDING} y={12} fontSize="10" fill="#8A8168" fontFamily="Inter, sans-serif">
          {maxValue}
          {unit}
        </text>
        <text x={PADDING} y={HEIGHT - PADDING + 16} fontSize="10" fill="#8A8168" fontFamily="Inter, sans-serif">
          {minValue}
          {unit}
        </text>
      </svg>
      <div className="flex items-center justify-between font-body text-[11px] text-steel mt-1">
        <span>{new Date(first.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span className={delta === 0 ? "" : delta > 0 ? "text-positive" : "text-rust"}>
          {delta > 0 ? "+" : ""}
          {Math.round(delta * 10) / 10}
          {unit} since first entry
        </span>
        <span>{new Date(last.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
    </div>
  );
}
