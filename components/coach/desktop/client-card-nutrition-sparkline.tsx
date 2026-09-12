import { buildSparklinePath } from "@/lib/program-card-visuals";
import type { NutritionPhase, NutritionWeeklySeries } from "@/lib/nutrition-trend-classifier";

const SPARK_W = 100;
const SPARK_H = 28;

// Literal hex, matching the same presentation-attribute convention
// already used by components/coach/desktop/program-card-visual.tsx and
// trend-chart.tsx.
const RUST = "#D2703B";
const STEEL = "#908B7E";

const PHASE_LABELS: Record<NutritionPhase, string> = {
  reverse_diet: "Reverse diet",
  cut: "Cut",
  bulk: "Bulk",
};

// A small, always-visible companion on a tagged client's roster card —
// Ron's own ask, "it would be cool to see that trend line on the
// clients cards." Two indexed lines sharing one scale (calories dashed
// steel, weight solid rust), same visual language as the Program Cards
// sparkline — this is a glance-level shape, not a detailed chart; the
// full numbers/alignment verdict live on the athlete's own profile page.
export function ClientCardNutritionSparkline({
  phase,
  series,
}: {
  phase: NutritionPhase;
  series: NutritionWeeklySeries;
}) {
  const finite = [...series.calorieIndexed, ...series.weightIndexed].filter(
    (v): v is number => v !== null
  );
  if (finite.length < 2) return null;

  const range = { min: Math.min(100, ...finite), max: Math.max(100, ...finite) };
  const calories = buildSparklinePath(series.calorieIndexed, SPARK_W, SPARK_H, range);
  const weight = buildSparklinePath(series.weightIndexed, SPARK_W, SPARK_H, range);

  return (
    <div className="w-full">
      <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-0.5">
        {PHASE_LABELS[phase]}
      </p>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="w-full h-5 overflow-visible"
        aria-label={`${PHASE_LABELS[phase]} trend — calories and body weight over the last several weeks`}
      >
        <path
          d={calories.linePath}
          fill="none"
          stroke={STEEL}
          strokeWidth={1.5}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={weight.linePath}
          fill="none"
          stroke={RUST}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex gap-2 font-body text-[9px] text-steel leading-none mt-0.5">
        <span className="flex items-center gap-1">
          <span className="w-2 h-0 border-t border-dashed border-steel inline-block" /> Calories
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-rust inline-block" /> Weight
        </span>
      </div>
    </div>
  );
}
