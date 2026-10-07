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
