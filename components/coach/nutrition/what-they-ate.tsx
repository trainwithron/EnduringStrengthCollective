import type { FoodWeekSummary } from "@/lib/food-week";
import type { WeeklyWeightTrend } from "@/lib/weight-trend";
import { formatWeight, type WeightUnit } from "@/lib/units";

const num = (n: number) => n.toLocaleString("en-US");

function weightLine(trend: WeeklyWeightTrend, unit: WeightUnit): string {
  if (trend.currentAvg == null) return "No weight logged in the last 7 days.";
  const base = `Weight: ${formatWeight(trend.currentAvg, unit)} average this week`;
  if (trend.deltaLbs == null) return `${base}.`;
  if (trend.deltaLbs === 0) return `${base}, the same as last week.`;
  return `${base}, ${trend.deltaLbs > 0 ? "up" : "down"} ${formatWeight(Math.abs(trend.deltaLbs), unit)} from last week.`;
}

// A read-only look at what the client logged over the last 7 days against their target: which days they logged anything, how close each day was to the calorie
// target, and the weight trend beside it. It reports; it never changes a target. "Logged anything" means any meal that was not skipped, so one coffee counts: it is a
// sign the client is engaging, not that the day was accurate.
export function WhatTheyAte({ week, weightTrend, clientName, weightUnit = "lb" }: { week: FoodWeekSummary; weightTrend: WeeklyWeightTrend; clientName: string; weightUnit?: WeightUnit }) {
  const targetDay = week.days.find((d) => d.target?.calories);
  return (
    <div>
      <p className="font-body text-sm text-chalk">
        {clientName} logged food on <span className="font-medium">{week.loggedDays} of 7</span> days
        {week.avgCalories != null ? (
          <>
            , averaging {num(week.avgCalories)} calories
            {week.avgProteinG != null ? ` and ${num(week.avgProteinG)} g protein` : ""} on the days they logged
          </>
        ) : null}
        .
      </p>
      <p className="font-body text-xs text-steel mt-1">{weightLine(weightTrend, weightUnit)}</p>
      {targetDay == null && <p className="font-body text-xs text-steel mt-1">No calorie target was set for these days, so there is nothing to compare against yet.</p>}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-7 gap-2">
        {week.days.map((d) => {
          const pct = d.caloriesPct;
          const barWidth = pct == null ? 0 : Math.min(100, pct);
          return (
            <div key={d.dateKey} className={`border p-2 ${d.isToday ? "border-rust/50" : "border-steel/20"}`}>
              <div className="flex sm:block items-baseline justify-between gap-2">
                <p className="font-body text-xs text-steel uppercase tracking-wide">
                  {d.weekday}
                  {d.isToday ? " · today" : ""}
                </p>
                {d.logged ? (
                  <p className="font-display text-lg leading-none sm:mt-1 [font-variant-numeric:tabular-nums]">
                    {num(d.calories)}
                    {d.target?.calories ? <span className="font-body text-xs text-steel"> / {num(d.target.calories)}</span> : null}
                  </p>
                ) : (
                  <p className="font-body text-xs text-steel sm:mt-1">Nothing logged</p>
                )}
              </div>
              {d.logged && (
                <>
                  <div className="mt-1.5 h-1.5 bg-steel/20" aria-hidden="true">
                    <div className={`h-full ${pct != null && pct > 110 ? "bg-amber-400" : "bg-rust"}`} style={{ width: `${barWidth}%` }} />
                  </div>
                  <p className="font-body text-xs text-steel mt-1.5 [font-variant-numeric:tabular-nums]">
                    {pct != null ? `${pct}% of target · ` : ""}P {num(d.proteinG)} · C {num(d.carbsG)} · F {num(d.fatG)}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {d.meals.slice(0, 6).map((m, i) => (
                      <li key={i} className={`font-body text-xs truncate ${m.skipped ? "text-steel/60 line-through" : "text-chalk/90"}`}>
                        {m.description || m.slot || "Meal"}
                      </li>
                    ))}
                    {d.meals.length > 6 && <li className="font-body text-xs text-steel">+{d.meals.length - 6} more</li>}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
