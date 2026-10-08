import { DRI_GROUPS, DRI_NUTRIENTS, PREGNANCY_LACTATION_NOTE, SAT_FAT_INFO, type DriEntry, type DriKind, type DriNutrient, type Sex } from "@/lib/dri-data";

// A person's reference intake for a nutrient: the Recommended Dietary Allowance (RDA) or Adequate Intake (AI) from the National Academies' Dietary Reference Intakes for their
// age and sex, with the Tolerable Upper Intake Level (UL) where one exists. The table itself is lib/dri-data.ts, with every value's source in docs/DRI_SOURCES.md.
//
// What the app does when it does not know the person:
//   * age unknown  -> the adult groups 19-30 and 31-50 are averaged, and the screen says "based on an adult average" (assumedAge);
//   * sex unknown  -> male and female are averaged, and the screen says so (assumedSex);
//   * under 1 or over 120 -> no reference at all (null): the app shows amounts only;
//   * pregnant or breastfeeding -> the table has no rows for these; the needs differ and the screen says to ask a clinician (PREGNANCY_LACTATION_NOTE). The app does not know
//     whether someone is pregnant, so this note is shown to everyone who is of an age to be.
// An upper limit is shown as information only, never as a target and never as a reason to change a plan.

export interface Reference {
  key: string;
  unit: string;
  label: string;
  // The daily amount to aim for; null when the table has none for this person (or the nutrient has no reference intake).
  target: number | null;
  kind: DriKind | null;
  // The Tolerable Upper Intake Level (or, for sodium, the chronic-disease-risk level), info only; the lowest one when averaging groups.
  ul: number | null;
  ulScope: string;
  // "Adults 19-30 and 31-50 (averaged)" or "Men 31-50".
  groupLabel: string;
  assumedAge: boolean;
  assumedSex: boolean;
  source: string;
  sourceUrl: string;
  note: string;
}

export const DRI_PREGNANCY_NOTE = PREGNANCY_LACTATION_NOTE;
export { SAT_FAT_INFO };

const SEX_LABEL: Record<Sex, string> = { male: "men", female: "women" };

// The DRI groups for an age in whole years (null = unknown, which means the two adult groups 19-30 and 31-50).
export function groupKeysForAge(age: number | null): { keys: string[]; assumed: boolean } | null {
  if (age == null) return { keys: ["19-30", "31-50"], assumed: true };
  if (!Number.isFinite(age) || age < 1 || age > 120) return null;
  const g = DRI_GROUPS.find((x) => age >= x.minAge && (x.maxAge == null || age <= x.maxAge));
  return g ? { keys: [g.key], assumed: false } : null;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n: number): number => Math.round(n * 100) / 100;

// The reference for one nutrient, or null when the person is outside the table or the nutrient is not in it.
export function referenceFor(key: string, age: number | null, sex: Sex | null): Reference | null {
  const n: DriNutrient | undefined = DRI_NUTRIENTS.find((x) => x.key === key);
  if (!n) return null;
  const groups = groupKeysForAge(age);
  if (!groups) return null;
  const sexes: Sex[] = sex ? [sex] : ["male", "female"];
  const entries: DriEntry[] = [];
  for (const g of groups.keys) for (const s of sexes) {
    const e = n.values[g]?.[s];
    if (e) entries.push(e);
  }
  if (entries.length === 0) return null;
  const targets = entries.map((e) => e.target).filter((t): t is number => t != null);
  const uls = entries.map((e) => e.ul).filter((u): u is number => u != null);
  // A target is only averaged when every row we would average has one; a half-known average is not shown.
  const target = targets.length === entries.length ? round(mean(targets)) : null;
  const kinds = new Set(entries.map((e) => e.kind));
  const kind: DriKind | null = target == null ? null : kinds.size === 1 ? entries[0].kind : "AI";
  const groupLabels = groups.keys.map((k) => DRI_GROUPS.find((g) => g.key === k)?.label ?? k);
  const who = sex ? SEX_LABEL[sex] : "men and women";
  const groupLabel = groups.assumed
    ? `Adults ${groupLabels.join(" and ")}${sex ? ` (${who})` : ""}, averaged`
    : `${sex ? who[0].toUpperCase() + who.slice(1) : "Men and women"} ${groupLabels[0]}${sex ? "" : ", averaged"}`;
  return {
    key,
    unit: n.unit,
    label: n.label,
    target,
    kind,
    ul: uls.length === 0 ? null : Math.min(...uls),
    ulScope: n.ulScope,
    groupLabel,
    assumedAge: groups.assumed,
    assumedSex: !sex,
    source: n.source,
    sourceUrl: n.sourceUrl,
    note: n.note,
  };
}

// "Based on an adult average because we don't have your age" and the like: the visible note under any figure that rests on an assumption. Null when nothing was assumed.
export function assumptionNote(ref: Pick<Reference, "assumedAge" | "assumedSex">): string | null {
  if (ref.assumedAge && ref.assumedSex) return "Based on an adult average, because your age and sex aren't filled in. Add them in About you for a closer figure.";
  if (ref.assumedAge) return "Based on an adult average, because your age isn't filled in. Add your date of birth in About you for a closer figure.";
  if (ref.assumedSex) return "Based on the average of men and women, because that isn't filled in. Add it in About you for a closer figure.";
  return null;
}

export const KIND_LABEL: Record<DriKind, string> = { RDA: "Recommended Dietary Allowance", AI: "Adequate Intake" };
