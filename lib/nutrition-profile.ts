import { computeBmr, computeTdee, type BiologicalSex } from "@/lib/bmr-tdee";

export interface BodyProfileInput {
  weightLbs: number | null;
  heightCm: number | null;
  sex: string | null;
  dateOfBirth: string | null; // "YYYY-MM-DD"
  bodyFatPct: number | null;
  todayKey: string;
}

const KG_PER_LB = 0.453592;

// Whole years between two date keys by their own parts (a birthday not reached yet this year does not count). Null when either key is not a date.
export function ageOnDate(dobKey: string, onKey: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobKey);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(onKey);
  if (!a || !b) return null;
  let age = Number(b[1]) - Number(a[1]);
  if (Number(b[2]) < Number(a[2]) || (Number(b[2]) === Number(a[2]) && Number(b[3]) < Number(a[3]))) age -= 1;
  return age;
}

export function asBiologicalSex(sex: string | null | undefined): BiologicalSex | null {
  return sex === "male" || sex === "female" ? sex : null;
}

// The client's estimated BMR, or null when ANY real input is missing: never a guessed age, height or weight (a wrong number defeats a safety floor).
export function estimateBmr(p: BodyProfileInput): number | null {
  const sex = asBiologicalSex(p.sex);
  if (p.weightLbs == null || p.heightCm == null || !sex || !p.dateOfBirth) return null;
  const age = ageOnDate(p.dateOfBirth, p.todayKey);
  if (age == null || age < 0 || age > 120) return null;
  const bmr = computeBmr({ weightKg: p.weightLbs * KG_PER_LB, heightCm: p.heightCm, age, sex, bodyFatPct: p.bodyFatPct ?? null });
  return Number.isFinite(bmr) ? bmr : null;
}

// Maintenance as the page worked it out before ("moderate" activity, the app's own fallback), now from the same one BMR.
export function estimateMaintenance(p: BodyProfileInput): number | null {
  const bmr = estimateBmr(p);
  return bmr == null ? null : computeTdee(bmr, "moderate");
}
