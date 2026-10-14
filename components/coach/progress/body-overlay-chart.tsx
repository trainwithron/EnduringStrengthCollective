"use client";

import { useEffect, useMemo, useState } from "react";
import { buildOverlay, readoutAt, type DayPoint, type Frame, type OverlayRange } from "@/lib/overlay-math";

// Two frames: a wide one, and a narrower, taller one for a phone so the numbers on the axes stay readable (the drawing is shown at about its own size, not shrunk).
const WIDE_FRAME: Frame = { width: 640, height: 270, left: 54, right: 58, top: 14, bottom: 34 };
const PHONE_FRAME: Frame = { width: 360, height: 300, left: 40, right: 46, top: 14, bottom: 32 };
const RANGES: OverlayRange[] = ["3M", "6M", "1Y", "All"];

const WEIGHT_COLOR = "#D2703B";
const TARGET_COLOR = "#E8E2D0";
const INTAKE_COLOR = "#7FA37A";
const AXIS_TEXT = "#8A8168";
const GRID = "#3A362F";

const number = (v: number) => Math.round(v).toLocaleString("en-US");
const longDate = (key: string) => new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// One graph: body weight on the left axis (pounds), the calorie target and what the client logged on the right axis (calories), on one shared time axis with one shared readout. Useful for seeing a
// reverse diet or a cut: what was targeted, what was eaten and what the scale did.
export function BodyOverlayChart({ weight, target, intake, todayKey }: { weight: DayPoint[]; target: DayPoint[]; intake: DayPoint[]; todayKey: string }) {
  const [range, setRange] = useState<OverlayRange>("6M");
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const FRAME = phone ? PHONE_FRAME : WIDE_FRAME;
  const model = useMemo(() => buildOverlay({ weight, target, intake }, range, todayKey, FRAME), [weight, target, intake, range, todayKey, FRAME]);
  const readout = hoverDay != null ? readoutAt(model.series, hoverDay) : null;
  const hasWeight = model.series.weight.length > 0;
  const hasTarget = model.series.target.length > 0;
  const hasIntake = model.series.intake.length > 0;

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * FRAME.width;
    if (x < FRAME.left || x > FRAME.width - FRAME.right) {
      setHoverDay(null);
      return;
    }
    setHoverDay(Math.min(model.endDay, Math.max(model.startDay, model.dayAt(x))));
  }

  const plotBottom = FRAME.height - FRAME.bottom;
  const swatch = (color: string, dashed = false) => (
    <svg width="22" height="8" aria-hidden className="inline-block mr-1.5 align-middle">
      <line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth={2.25} strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );

  return (
    <section aria-labelledby="body-overlay-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-2">
        <h2 id="body-overlay-heading" className="font-display uppercase text-sm tracking-wide text-steel">
          Body Weight and Calories
        </h2>
        <div role="group" aria-label="Time range" className="flex">
          {RANGES.map((r, i) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`min-h-11 min-w-11 px-3 font-body text-xs border border-steel/30 ${i > 0 ? "-ml-px" : ""} ${range === r ? "bg-chalk text-graphite" : "text-steel hover:text-chalk"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {!model.hasData ? (
        <p className="font-body text-sm text-steel py-2">Nothing to chart yet. Body weight, a calorie target or logged food will appear here.</p>
      ) : (
        <>
          <p className="font-body text-xs text-steel flex flex-wrap gap-x-4 gap-y-1">
            {hasWeight && (
              <span>
                {swatch(WEIGHT_COLOR)}Body weight (left, lbs)
              </span>
            )}
            {hasTarget && (
              <span>
                {swatch(TARGET_COLOR, true)}Calorie target (right, cal)
              </span>
            )}
            {hasIntake && (
              <span>
                {swatch(INTAKE_COLOR)}Logged intake (right, cal)
              </span>
            )}
          </p>
          <p className="font-body text-xs text-chalk min-h-[1.25rem] mt-1" aria-live="polite">
            {readout
              ? [
                  longDate(readout.date),
                  readout.weight != null ? `Body weight ${readout.weight} lbs` : null,
                  readout.target != null ? `Target ${number(readout.target)} cal` : null,
                  readout.intake != null ? `Logged ${number(readout.intake)} cal` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : ""}
          </p>
          <svg
            viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
            className="w-full h-auto touch-pan-y"
            role="img"
            aria-label="Body weight over the calorie target and logged calories"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverDay(null)}
          >
            {(model.weightScale ?? model.calorieScale)!.ticks.map((_, i, all) => {
              const y = FRAME.top + (1 - i / (all.length - 1)) * (plotBottom - FRAME.top);
              return <line key={i} x1={FRAME.left} x2={FRAME.width - FRAME.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />;
            })}
            {model.weightScale &&
              model.weightScale.ticks.map((t) => (
                <text key={`w${t}`} x={FRAME.left - 6} y={model.weightY(t) + 3.5} textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                  {t}
                </text>
              ))}
            {model.calorieScale &&
              model.calorieScale.ticks.map((t) => (
                <text key={`c${t}`} x={FRAME.width - FRAME.right + 6} y={model.calorieY(t) + 3.5} textAnchor="start" fontSize={11} fill={AXIS_TEXT}>
                  {number(t)}
                </text>
              ))}
            {model.xTicks.map((t, i) => (
              <text key={i} x={t.x} y={FRAME.height - 12} textAnchor={i === 0 ? "start" : i === model.xTicks.length - 1 ? "end" : "middle"} fontSize={11} fill={AXIS_TEXT}>
                {t.label}
              </text>
            ))}
            <line x1={FRAME.left} x2={FRAME.width - FRAME.right} y1={plotBottom} y2={plotBottom} stroke={AXIS_TEXT} strokeWidth={1} />
            {hasTarget && <path d={model.paths.target} fill="none" stroke={TARGET_COLOR} strokeWidth={1.75} strokeDasharray="5 4" />}
            {hasIntake && <path d={model.paths.intake} fill="none" stroke={INTAKE_COLOR} strokeWidth={1.25} />}
            {hasWeight && <path d={model.paths.weight} fill="none" stroke={WEIGHT_COLOR} strokeWidth={2.25} />}
            {hasWeight && model.weightDots.map((p) => <circle key={p.date} cx={p.x} cy={p.y} r={2.5} fill={WEIGHT_COLOR} />)}
            {hoverDay != null && <line x1={model.xOf(hoverDay)} x2={model.xOf(hoverDay)} y1={FRAME.top} y2={plotBottom} stroke={AXIS_TEXT} strokeWidth={1} strokeDasharray="2 3" />}
          </svg>
        </>
      )}
    </section>
  );
}

