"use client";

import { useState } from "react";
import { cellText, GLANCE_ROWS, type GlanceDay, type MacroRowKey, type NutrientBar, type WeekAverage } from "@/lib/nutrition-glance";
import { formatWeight, type WeightUnit } from "@/lib/units";

// The top of a coach's Nutrition page (lib/nutrition-glance.ts): this week at a glance. A column per day with four bars filled to that day's target (today outlined), the chosen day's numbers
// beside it (consumed or remaining), the week's daily average as a ring with protein / carbs / fat, the weight trend and what they really burn. Tapping a day opens what they logged by meal,
// with the day's key vitamins and minerals as small bars under it.
const ROW_COLOR: Record<MacroRowKey, string> = { calories: "bg-rust", protein: "bg-blue-400", carbs: "bg-positive", fat: "bg-amber" };
const RING_COLOR: Record<Exclude<MacroRowKey, "calories">, string> = { protein: "#5E94BA", carbs: "#7DB586", fat: "#D9A441" };
const MACRO_LABEL: Record<Exclude<MacroRowKey, "calories">, string> = { protein: "Protein", carbs: "Carbs", fat: "Fat" };
const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function NutritionGlance({
  days,
  average,
  rangeLabel,
  nutrientsByDay,
  weight,
  weightUnit = "lb",
  burn,
  clientName,
}: {
  days: GlanceDay[];
  average: WeekAverage | null;
  /** "Oct 15 – 21" */
  rangeLabel: string;
  nutrientsByDay: Record<string, NutrientBar[]>;
  weight: { points: { date: string; weight: number }[]; change: number | null };
  weightUnit?: WeightUnit;
  /** What they really burn (lib/real-maintenance.ts), only once there is enough logged to trust it. */
  burn: { calories: number; sentence: string } | null;
  clientName: string;
}) {
  const today = days.find((d) => d.isToday) ?? days[days.length - 1];
  const [selectedKey, setSelectedKey] = useState(today?.dateKey ?? "");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"consumed" | "remaining">("consumed");
  const selected = days.find((d) => d.dateKey === selectedKey) ?? today;
  const loggedDays = days.filter((d) => d.logged).length;

  function pick(day: GlanceDay) {
    if (day.dateKey === selectedKey) setOpen((v) => !v);
    else {
      setSelectedKey(day.dateKey);
      setOpen(true);
    }
  }

  return (
    <div className="space-y-4" data-nutrition-glance>
      <div className="border border-steel/20 bg-surface/40 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <p className="font-body text-sm text-chalk">
            Logged food on <span className="font-medium">{loggedDays} of 7</span> days
          </p>
          <div role="group" aria-label="Show" className="flex border border-steel/30">
            {(["consumed", "remaining"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`h-9 px-3 font-body text-xs ${mode === m ? "bg-chalk text-graphite" : "text-steel"}`}
              >
                {m === "consumed" ? "Consumed" : "Remaining"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4 items-stretch">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 flex-1 min-w-0" role="group" aria-label="The last 7 days">
            {days.map((d) => {
              const isSel = d.dateKey === selected?.dateKey;
              return (
                <button
                  key={d.dateKey}
                  type="button"
                  onClick={() => pick(d)}
                  aria-label={`${d.weekday}${d.isToday ? " (today)" : ""}: ${d.logged ? `${n(d.cells.calories.eaten)} calories` : "nothing logged"}. Show what they logged`}
                  aria-expanded={isSel && open}
                  className={`flex flex-col items-center gap-1 py-1.5 border ${isSel ? "border-chalk/70" : d.isToday ? "border-rust/60" : "border-transparent"} hover:border-steel/40`}
                  data-glance-day={d.dateKey}
                >
                  {GLANCE_ROWS.map((r) => {
                    const c = d.cells[r.key];
                    const fill = c.pct == null ? 0 : Math.min(100, c.pct);
                    return (
                      <span key={r.key} className="relative w-3 sm:w-4 h-8 bg-steel/15" aria-hidden="true">
                        <span className={`absolute bottom-0 left-0 right-0 ${ROW_COLOR[r.key]}`} style={{ height: `${fill}%` }} />
                        {c.pct != null && c.pct > 110 && <span className="absolute -top-1 left-0 right-0 h-0.5 bg-chalk" />}
                      </span>
                    );
                  })}
                  <span className={`font-body text-xs ${d.isToday ? "text-chalk font-medium" : "text-steel"}`}>{d.letter}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <dl className="w-32 sm:w-40 shrink-0 flex flex-col justify-between py-1.5" aria-label={`${selected.weekday}${selected.isToday ? ", today" : ""}`}>
              {GLANCE_ROWS.map((r) => (
                <div key={r.key} className="flex items-center gap-2 h-8">
                  <span className={`w-1.5 h-4 shrink-0 ${ROW_COLOR[r.key]}`} aria-hidden="true" />
                  <dt className="sr-only">{r.label}</dt>
                  <dd className="font-body text-xs text-chalk leading-tight [font-variant-numeric:tabular-nums]">
                    {selected.logged || mode === "remaining" ? cellText(selected.cells[r.key], mode) : "—"}
                    <span className="text-steel"> {r.key === "calories" ? "" : r.label.charAt(0)}</span>
                  </dd>
                </div>
              ))}
              <p className="font-body text-xs text-steel h-5">{selected.isToday ? "Today" : selected.weekday}</p>
            </dl>
          )}
        </div>

        {selected && open && (
          <div className="mt-4 border-t border-steel/20 pt-3 space-y-4" data-glance-open={selected.dateKey}>
            <div>
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">What {clientName} logged {selected.isToday ? "today" : `on ${selected.weekday}`}</p>
              {selected.meals.length === 0 ? (
                <p className="font-body text-sm text-steel">Nothing logged.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                  {selected.meals.map((m) => (
                    <div key={m.slot}>
                      <p className="font-body text-xs text-steel">{m.slot}</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {m.items.map((it, i) => (
                          <li key={i} className={`flex justify-between gap-3 font-body text-sm ${it.skipped ? "text-steel line-through" : "text-chalk"}`}>
                            <span className="truncate">{it.description}</span>
                            {it.calories != null && <span className="shrink-0 text-steel [font-variant-numeric:tabular-nums]">{n(it.calories)}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <NutrientBars bars={nutrientsByDay[selected.dateKey] ?? []} logged={selected.logged} />
          </div>
        )}
        {!open && <p className="font-body text-xs text-steel mt-2">Tap a day to see what they logged.</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border border-steel/20 p-4 md:col-span-1">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Daily average · {rangeLabel}</p>
          {average ? (
            <div className="mt-3 flex items-center gap-4">
              <AverageRing average={average} />
              <table className="font-body text-xs [font-variant-numeric:tabular-nums]">
                <tbody>
                  {average.macros.map((m) => (
                    <tr key={m.key}>
                      <td className="pr-3 py-0.5" style={{ color: RING_COLOR[m.key] }}>
                        {MACRO_LABEL[m.key]}
                      </td>
                      <td className="pr-3 text-chalk text-right">{n(m.grams)} g</td>
                      <td className="text-steel text-right">{m.pctOfCalories}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="font-body text-sm text-steel mt-3">Nothing logged this week.</p>
          )}
          {average && <p className="font-body text-xs text-steel mt-2">Over the {average.loggedDays} {average.loggedDays === 1 ? "day" : "days"} they logged.</p>}
        </div>

        <div className="border border-steel/20 p-4">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Weight trend</p>
          {weight.points.length > 0 ? (
            <>
              <Sparkline values={weight.points.map((p) => p.weight)} />
              <p className="font-display text-xl leading-none mt-2">{formatWeight(weight.points[weight.points.length - 1].weight, weightUnit)}</p>
              <p className="font-body text-xs text-steel mt-1">
                {weight.change == null || weight.points.length < 2
                  ? "One weigh-in in the last 30 days."
                  : weight.change === 0
                    ? "No change over the last 30 days."
                    : `${weight.change > 0 ? "Up" : "Down"} ${formatWeight(Math.abs(weight.change), weightUnit)} over the last 30 days.`}
              </p>
            </>
          ) : (
            <p className="font-body text-sm text-steel mt-3">No weigh-ins in the last 30 days.</p>
          )}
        </div>

        <div className="border border-steel/20 p-4">
          <p className="font-body text-xs text-steel uppercase tracking-wide">What they really burn</p>
          {burn ? (
            <>
              <p className="font-display text-xl leading-none mt-3">{n(burn.calories)} kcal</p>
              <p className="font-body text-xs text-steel mt-1">{burn.sentence}</p>
            </>
          ) : (
            <p className="font-body text-sm text-steel mt-3">Shows after two weeks of logging food and weighing in.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NutrientBars({ bars, logged }: { bars: NutrientBar[]; logged: boolean }) {
  if (!logged) return null;
  const reported = bars.filter((b) => b.pct != null);
  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Vitamins and minerals</p>
      {reported.length === 0 ? (
        <p className="font-body text-sm text-steel">None of the foods logged this day report vitamins and minerals (a quick calorie entry or a photo estimate does not).</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5" aria-label="Key vitamins and minerals as a percent of the reference intake">
          {bars.map((b) => (
            <li key={b.key} className="grid grid-cols-[7.5rem_1fr_2.75rem] items-center gap-2">
              <span className="font-body text-xs text-chalk truncate">
                {b.label}
                {b.worthALook && <span className="ml-1 text-amber">•</span>}
              </span>
              <span className="h-1.5 bg-steel/15" aria-hidden="true">
                {b.pct != null && <span className="block h-full bg-moss" style={{ width: `${Math.min(100, b.pct)}%` }} />}
              </span>
              <span className="font-body text-xs text-steel text-right [font-variant-numeric:tabular-nums]">{b.pct == null ? "n/r" : `${b.pct}%`}</span>
            </li>
          ))}
        </ul>
      )}
      {reported.length > 0 && (
        <p className="font-body text-xs text-steel mt-1.5">
          Percent of the reference intake. n/r = not reported by the foods logged, never zero.{bars.some((b) => b.worthALook) ? " • = low most days over the last two weeks." : ""} General nutrition information, not medical advice.
        </p>
      )}
    </div>
  );
}

function AverageRing({ average }: { average: WeekAverage }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 88 88" className="w-24 h-24 shrink-0" role="img" aria-label={`${n(average.calories)} calories a day on average`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-steel/20" />
      {average.macros.map((m) => {
        const len = (m.pctOfCalories / 100) * c;
        const el = <circle key={m.key} cx="44" cy="44" r={r} fill="none" stroke={RING_COLOR[m.key]} strokeWidth="8" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 44 44)" />;
        offset += len;
        return el;
      })}
      <text x="44" y="44" textAnchor="middle" className="fill-chalk font-display" fontSize="15">
        {n(average.calories)}
      </text>
      <text x="44" y="57" textAnchor="middle" className="fill-steel font-body" fontSize="8">
        kcal
      </text>
    </svg>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-10 mt-3" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - ((v - min) / span) * 32}`).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-10 mt-3" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#5E94BA" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="#5E94BA" />
    </svg>
  );
}
