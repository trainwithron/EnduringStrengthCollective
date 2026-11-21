import type { SupabaseClient } from "@supabase/supabase-js";

// Tape measurements (wave 2, P6; Ron, Nov 20): waist, hips, chest, arm and thigh, entered by the client or the coach, one graph each. Stored in inches
// (body_measurements, step 213); a person who uses kilograms reads and types centimetres. The ranges match the table's own checks, so a number the database
// would refuse is caught here first with a plain message. Every read is soft: before step 213 is applied (or when a read fails) there are simply no measurements.

export const MEASUREMENT_FIELDS = ["waist", "hips", "chest", "arm", "thigh"] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

export const MEASUREMENT_LABELS: Record<MeasurementField, string> = { waist: "Waist", hips: "Hips", chest: "Chest", arm: "Arm", thigh: "Thigh" };

// Inches, the same as the table's checks (step 213).
export const MEASUREMENT_RANGE_IN: Record<MeasurementField, [number, number]> = { waist: [10, 100], hips: [10, 100], chest: [10, 100], arm: [3, 40], thigh: [5, 60] };

export type TapeUnit = "in" | "cm";
const CM_PER_IN = 2.54;

/** Inches for a person who uses pounds, centimetres for one who uses kilograms. */
export function tapeUnitFor(weightUnit: string | null | undefined): TapeUnit {
  return weightUnit === "kg" ? "cm" : "in";
}

export interface MeasurementRow {
  date: string; // YYYY-MM-DD
  waist: number | null; // inches
  hips: number | null;
  chest: number | null;
  arm: number | null;
  thigh: number | null;
}

/** A stored inch value shown in the person's unit, to one decimal. */
export function showTape(inches: number, unit: TapeUnit): number {
  return Number((unit === "cm" ? inches * CM_PER_IN : inches).toFixed(1));
}

/** What a person typed, in their unit, to inches for storing; or why it cannot be saved. Empty is "no measurement" (null), never zero. */
export function parseTape(field: MeasurementField, typed: string, unit: TapeUnit): { ok: true; inches: number | null } | { ok: false; message: string } {
  const t = typed.trim().replace(",", ".");
  if (t === "") return { ok: true, inches: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, message: `${MEASUREMENT_LABELS[field]} needs a number.` };
  const inches = Number((unit === "cm" ? n / CM_PER_IN : n).toFixed(2));
  const [lo, hi] = MEASUREMENT_RANGE_IN[field];
  if (inches < lo || inches > hi) {
    const range = unit === "cm" ? `${Math.round(lo * CM_PER_IN)} to ${Math.round(hi * CM_PER_IN)} cm` : `${lo} to ${hi} in`;
    return { ok: false, message: `${MEASUREMENT_LABELS[field]} looks off. Use ${range}.` };
  }
  return { ok: true, inches };
}

/** One measurement over time, oldest first, in the person's unit (the graph's points). Days without it are left out. */
export function measurementSeries(rows: MeasurementRow[], field: MeasurementField, unit: TapeUnit): { date: string; value: number }[] {
  return rows
    .filter((r) => r[field] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, value: showTape(r[field] as number, unit) }));
}

/** The change from the first to the latest reading, in the person's unit ("-2.5 in"), or null with fewer than two. */
export function measurementChange(rows: MeasurementRow[], field: MeasurementField, unit: TapeUnit): number | null {
  const s = measurementSeries(rows, field, unit);
  if (s.length < 2) return null;
  return Number((s[s.length - 1].value - s[0].value).toFixed(1));
}

const toNum = (v: unknown) => (v == null ? null : Number(v));

export async function readMeasurements(supabase: SupabaseClient, athleteId: string, groupId: string): Promise<MeasurementRow[]> {
  try {
    const { data, error } = await supabase
      .from("body_measurements")
      .select("measured_on, waist_in, hips_in, chest_in, arm_in, thigh_in")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("measured_on", { ascending: true })
      .limit(1000);
    if (error) return [];
    return ((data ?? []) as any[]).map((r) => ({
      date: String(r.measured_on),
      waist: toNum(r.waist_in),
      hips: toNum(r.hips_in),
      chest: toNum(r.chest_in),
      arm: toNum(r.arm_in),
      thigh: toNum(r.thigh_in),
    }));
  } catch {
    return [];
  }
}

/** Saves a day's measurements (one row a day: a second save that day changes it). Only the fields given are written; null clears one. */
export async function saveMeasurements(
  supabase: SupabaseClient,
  input: { athleteId: string; groupId: string; date: string; values: Partial<Record<MeasurementField, number | null>> }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const row: Record<string, unknown> = { athlete_id: input.athleteId, group_id: input.groupId, measured_on: input.date };
  for (const f of MEASUREMENT_FIELDS) if (f in input.values) row[`${f}_in`] = input.values[f] ?? null;
  const { error } = await supabase.from("body_measurements").upsert(row, { onConflict: "athlete_id,measured_on" });
  if (error) return { ok: false, message: measurementSaveMessage(`${error.code ?? ""} ${error.message ?? ""}`) };
  return { ok: true };
}

// ---- for the Measurements screen (wave 2, P6) ----

/** Why a save did not go through, in plain words: before step 213 the table is not there yet. */
export function measurementSaveMessage(raw: string): string {
  if (/one_value/.test(raw)) return "Add at least one measurement.";
  if (/PGRST205|42P01|schema cache|does not exist/i.test(raw)) return "Measurements are not switched on yet.";
  return "That did not save. Try again.";
}

/** The newest reading of one measurement, in the person's unit, or null when it was never taken. */
export function latestMeasurement(rows: MeasurementRow[], field: MeasurementField, unit: TapeUnit): { date: string; value: number } | null {
  const s = measurementSeries(rows, field, unit);
  return s.length > 0 ? s[s.length - 1] : null;
}

/** The measurement the screen opens on: the first one (waist, hips, chest, arm, thigh) that has a reading; waist when there are none. */
export function featuredMeasurement(rows: MeasurementRow[]): MeasurementField {
  return MEASUREMENT_FIELDS.find((f) => rows.some((r) => r[f] != null)) ?? "waist";
}

/** A change written with its sign: "−2.0", "+0.5", "0.0" (a real minus sign). */
export function formatTapeChange(change: number): string {
  const v = Math.abs(change).toFixed(1);
  if (change > 0) return `+${v}`;
  if (change < 0) return `−${v}`;
  return "0.0";
}

/** Whether a change reads as progress: only a smaller waist or hips. Chest, arm and thigh are never judged either way. */
export function changeIsProgress(field: MeasurementField, change: number | null): boolean {
  return change != null && change < 0 && (field === "waist" || field === "hips");
}
