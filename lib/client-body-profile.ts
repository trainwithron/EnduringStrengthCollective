import { asWeightUnit, type WeightUnit } from "@/lib/units";

// What the calculator needs to know about a client, read from ONE place. The row is athlete_profile_details (the client writes their own; a coach writes the calculator's
// inputs through coach_set_body_profile), and the date of birth comes from the intake when it has one, else from the profile's own birthday: asked once, never twice.

export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "very_active"] as const;
export type ActivityKey = (typeof ACTIVITY_LEVELS)[number];

export const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  sedentary: "Mostly sitting (desk job, little exercise)",
  light: "Lightly active (light exercise 1 to 3 days a week)",
  moderate: "Moderately active (training 3 to 5 days a week)",
  very_active: "Very active (hard training most days, or a physical job)",
};

export const SHORT_ACTIVITY_LABELS: Record<ActivityKey, string> = {
  sedentary: "Mostly sitting",
  light: "Lightly active",
  moderate: "Moderately active",
  very_active: "Very active",
};

export type PortionUnits = "household" | "grams";

export interface BodyProfile {
  heightCm: number | null;
  // 'male' | 'female', or null for "prefer not to say" (the formulas then use the average of the two).
  sex: "male" | "female" | null;
  bodyFatPct: number | null;
  activity: ActivityKey | null;
  weightUnit: WeightUnit;
  portionUnits: PortionUnits;
  // The profile's own birthday (athlete_profile_details.birthday), kept apart so the reader below can show where the date came from.
  birthday: string | null;
  intakeDateOfBirth: string | null;
}

const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const asNumber = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function rowToBodyProfile(details: Record<string, unknown> | null | undefined, intake: Record<string, unknown> | null | undefined): BodyProfile {
  const d = details ?? {};
  const sex = d.biological_sex === "male" || d.biological_sex === "female" ? d.biological_sex : null;
  const activity = (ACTIVITY_LEVELS as readonly string[]).includes(d.activity_level as string) ? (d.activity_level as ActivityKey) : null;
  return {
    heightCm: asNumber(d.height_cm),
    sex,
    bodyFatPct: asNumber(d.body_fat_pct),
    activity,
    weightUnit: asWeightUnit(d.weight_unit),
    portionUnits: d.portion_units === "household" ? "household" : "grams",
    birthday: isDateKey(d.birthday) ? d.birthday.slice(0, 10) : null,
    intakeDateOfBirth: isDateKey(intake?.date_of_birth) ? String(intake?.date_of_birth).slice(0, 10) : null,
  };
}

// The one date-of-birth reader: the intake's date, else the profile's birthday.
export function readDateOfBirth(p: Pick<BodyProfile, "intakeDateOfBirth" | "birthday">): string | null {
  return p.intakeDateOfBirth ?? p.birthday ?? null;
}

// What is still missing for a starting target. Sex is not required: "prefer not to say" falls back to the average of the two formulas.
export function missingForBaseline(p: BodyProfile, weightLbs: number | null): string[] {
  const missing: string[] = [];
  if (p.heightCm == null) missing.push("height");
  if (weightLbs == null) missing.push("a weight");
  if (!readDateOfBirth(p)) missing.push("date of birth");
  if (!p.activity) missing.push("activity level");
  return missing;
}

export const aboutYouComplete = (p: BodyProfile, weightLbs: number | null): boolean => missingForBaseline(p, weightLbs).length === 0;
