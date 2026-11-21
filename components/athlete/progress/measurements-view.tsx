"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { ProgressLineChart } from "@/components/athlete/progress/progress-line-chart";
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_LABELS,
  changeIsProgress,
  featuredMeasurement,
  formatTapeChange,
  latestMeasurement,
  measurementChange,
  measurementSeries,
  parseTape,
  saveMeasurements,
  showTape,
  type MeasurementField,
  type MeasurementRow,
  type TapeUnit,
} from "@/lib/body-measurements";

// Measurements (wave 2, P6; Ron approved the mockup Nov 20): one measurement featured with its latest number and its line, the other four listed with their latest
// number and their change since the first reading, and "Add today's measurements". Only a smaller waist or hips is shown as progress (green); chest, arm and thigh
// are never judged up or down. Tapping a row features it.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1] ?? "";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MeasurementsView({ rows, unit, athleteId, groupId }: { rows: MeasurementRow[]; unit: TapeUnit; athleteId: string; groupId: string }) {
  const [featured, setFeatured] = useState<MeasurementField>(() => featuredMeasurement(rows));
  const [adding, setAdding] = useState(false);

  const latest = latestMeasurement(rows, featured, unit);
  const change = measurementChange(rows, featured, unit);
  const series = measurementSeries(rows, featured, unit);
  const others = MEASUREMENT_FIELDS.filter((f) => f !== featured);

  return (
    <div className="flex flex-col gap-3">
      <section className="bg-surface rounded-card p-4 flex flex-col gap-2" aria-label={`${MEASUREMENT_LABELS[featured]} over time`} data-featured-measurement={featured}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-body text-[15px] font-semibold text-chalk">{MEASUREMENT_LABELS[featured]}</h2>
          {change != null && series.length > 1 && (
            <span className={`font-body text-[13px] font-semibold ${changeIsProgress(featured, change) ? "text-win" : "text-steel"}`}>
              {formatTapeChange(change)} {unit} since {monthOf(series[0].date)}
            </span>
          )}
        </div>
        <p className="font-display font-medium text-3xl text-chalk tabular-nums">{latest ? `${latest.value.toFixed(1)} ${unit}` : "Not measured yet"}</p>
        <ProgressLineChart
          points={series}
          dots
          height={90}
          label={series.length > 1 ? `${MEASUREMENT_LABELS[featured]}, from ${series[0].value} to ${series[series.length - 1].value} ${unit}` : `${MEASUREMENT_LABELS[featured]}`}
          emptyLabel="Two or more entries draw the line."
        />
      </section>

      <section className="bg-surface rounded-card px-4 py-1.5" aria-label="Other measurements">
        <ul className="divide-y divide-steel/15">
          {others.map((f) => {
            const l = latestMeasurement(rows, f, unit);
            const c = measurementChange(rows, f, unit);
            return (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => setFeatured(f)}
                  className="w-full min-h-11 py-3 flex items-center justify-between gap-3 text-left"
                  aria-label={`Show ${MEASUREMENT_LABELS[f]} on the graph`}
                >
                  <span className="font-body text-sm text-chalk">{MEASUREMENT_LABELS[f]}</span>
                  {l ? (
                    <span className="font-body text-sm text-chalk tabular-nums">
                      <b className="font-semibold">
                        {l.value.toFixed(1)} {unit}
                      </b>
                      {c != null && <span className={`ml-1.5 text-xs ${changeIsProgress(f, c) ? "text-win" : "text-steel"}`}>{formatTapeChange(c)}</span>}
                    </span>
                  ) : (
                    <span className="font-body text-xs text-steel">Not measured yet</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {adding ? (
        <MeasurementsForm rows={rows} unit={unit} athleteId={athleteId} groupId={groupId} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full min-h-[52px] bg-rust text-graphite rounded-token-pill font-body text-base font-semibold">
          Add today&apos;s measurements
        </button>
      )}
      <p className="font-body text-xs text-steel text-center">Measure at the same spot each time, first thing in the morning.</p>
    </div>
  );
}

function MeasurementsForm({ rows, unit, athleteId, groupId, onDone }: { rows: MeasurementRow[]; unit: TapeUnit; athleteId: string; groupId: string; onDone: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(todayKey());
  // A day already measured opens with its numbers, so saving again changes that day instead of looking empty.
  const valuesFor = (d: string): Record<MeasurementField, string> => {
    const row = rows.find((r) => r.date === d);
    return Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, row && row[f] != null ? String(showTape(row[f] as number, unit)) : ""])) as Record<MeasurementField, string>;
  };
  const [typed, setTyped] = useState<Record<MeasurementField, string>>(() => valuesFor(todayKey()));
  const [errors, setErrors] = useState<Partial<Record<MeasurementField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const values: Partial<Record<MeasurementField, number | null>> = {};
    const nextErrors: Partial<Record<MeasurementField, string>> = {};
    for (const f of MEASUREMENT_FIELDS) {
      const parsed = parseTape(f, typed[f], unit);
      if (parsed.ok) values[f] = parsed.inches;
      else nextErrors[f] = parsed.message;
    }
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;
    if (MEASUREMENT_FIELDS.every((f) => values[f] == null)) {
      setFormError("Add at least one measurement.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey()) {
      setFormError("Pick today or an earlier day.");
      return;
    }
    setSaving(true);
    const result = await saveMeasurements(createBrowserClient(), { athleteId, groupId, date, values });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <section className="bg-surface rounded-card p-4 flex flex-col gap-3" aria-label="Add measurements">
      <h2 className="font-body text-[15px] font-semibold text-chalk">Add measurements</h2>
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-steel">Date</span>
        <input
          type="date"
          value={date}
          max={todayKey()}
          onChange={(e) => {
            setDate(e.target.value);
            setTyped(valuesFor(e.target.value));
          }}
          className="h-12 px-3 rounded-row bg-surface-2 border border-steel/30 text-chalk font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {MEASUREMENT_FIELDS.map((f) => (
          <label key={f} className="flex flex-col gap-1 min-w-0">
            <span className="font-body text-[13px] font-semibold text-steel">
              {MEASUREMENT_LABELS[f]} ({unit})
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={typed[f]}
              onChange={(e) => setTyped((t) => ({ ...t, [f]: e.target.value }))}
              aria-invalid={!!errors[f]}
              aria-describedby={errors[f] ? `measure-${f}-error` : undefined}
              className="h-12 px-3 w-full min-w-0 rounded-row bg-surface-2 border border-steel/30 text-chalk font-body text-sm tabular-nums focus:outline-none focus:border-rust"
            />
            {errors[f] && (
              <span id={`measure-${f}-error`} className="font-body text-xs text-alert">
                {errors[f]}
              </span>
            )}
          </label>
        ))}
      </div>
      {formError && (
        <p className="font-body text-sm text-alert" role="alert">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="flex-1 min-h-12 bg-rust text-graphite rounded-token-pill font-body text-sm font-semibold disabled:opacity-60">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} disabled={saving} className="min-h-12 px-5 rounded-token-pill border border-steel/40 text-chalk font-body text-sm">
          Cancel
        </button>
      </div>
    </section>
  );
}
