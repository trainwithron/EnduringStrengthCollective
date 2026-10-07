import type { BiologicalSex } from "@/lib/bmr-tdee";

// A SOFT floor for a calorie target: the greater of the client's estimated BMR (when it can be worked out) and 1200 (female, or sex not on file) or 1500 (male).
// It only ever drives a warning the coach can read past ("apply anyway"): it never blocks a save and never changes a number.
export const FLOOR_FEMALE_OR_UNKNOWN = 1200;
export const FLOOR_MALE = 1500;

export function calorieFloor(args: { sex: BiologicalSex | null; bmr: number | null }): number {
  const base = args.sex === "male" ? FLOOR_MALE : FLOOR_FEMALE_OR_UNKNOWN;
  const bmr = args.bmr != null && Number.isFinite(args.bmr) && args.bmr > 0 ? Math.round(args.bmr) : 0;
  return Math.max(base, bmr);
}

export function isBelowFloor(calories: number | null | undefined, floor: number): boolean {
  return calories != null && Number.isFinite(calories) && calories > 0 && calories < floor;
}

// The amber line shown under a target or a suggestion that is under the floor. `who` is a first name or "this client".
export function belowFloorMessage(calories: number, floor: number, who: string): string {
  return `${calories.toLocaleString("en-US")} is under ${who === "this client" ? "this client's" : `${who}'s`} estimated floor of ${floor.toLocaleString("en-US")}. Calories this low are rarely a good idea. You can still apply it.`;
}

// What the floor rests on, in one plain line (shown with the warning): an old weight, or the missing inputs that make it fall back to the base floor. Null when it rests on
// a recent weight and a full profile. A male client with no sex on file gets the 1,200 base, so that gap is named.
export function floorBasisNote(args: { bmr: number | null; weightAgeDays: number | null; missing: string[]; floor: number }): string | null {
  if (args.bmr == null) {
    const what = args.missing.length > 0 ? args.missing.join(", ") : "height, sex and date of birth";
    return `This is the base floor of ${args.floor.toLocaleString("en-US")}: add ${what} for a precise one.`;
  }
  if (args.weightAgeDays != null && args.weightAgeDays > 30) return `Based on a weight from ${args.weightAgeDays} days ago.`;
  return null;
}
