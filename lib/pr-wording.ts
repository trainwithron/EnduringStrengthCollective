import { liftDisplayValue, liftUnitLabel } from "@/lib/lift-weight";
import type { WeightUnit } from "@/lib/units";

// What a PR notice says (wave 2, P3; Ron, Nov 20): the lift, the weight and the reps, never a bare "new PR!" ("'Client achieved personal best' - Great but WHAT?").
// One place for the words, so the coach's push, the share card and Home's shout-out always say it the same way. Weights are stored in pounds; a notice always writes
// the unit, in the reader's own unit when it is known (Assistant review of 1c9b3591: a kilogram reader read "225" as kilograms): "New PR: Back Squat 225 lb × 5", "102 kg × 5".

export interface PrSet {
  name: string;
  weight: number | null; // null for a record that is not a weight (a distance, a time) or whose set could not be read
  reps: number | null;
}


/** "Back Squat 225 lb × 5" (or "102.1 kg × 5" for a kilogram reader), or just "Back Squat" when the set is not known. The weight is the stored pounds. */
export function prSetText(pr: PrSet, unit: WeightUnit = "lb"): string {
  const name = pr.name.trim();
  if (pr.weight != null && pr.weight > 0 && pr.reps != null && pr.reps > 0) {
    const v = liftDisplayValue(pr.weight, unit);
    return `${name} ${Number.isInteger(v) ? v : Number(v.toFixed(1))} ${liftUnitLabel(unit)} × ${pr.reps}`;
  }
  return name;
}

/** "New PR: Back Squat 225 × 5"; with more than one, "New PRs: Back Squat 225 × 5 and Bench Press 185 × 8", or "... and 2 more" past two. Empty for none. */
export function prHeadline(prs: PrSet[], unit: WeightUnit = "lb"): string {
  const list = prs.filter((p) => p.name.trim());
  if (list.length === 0) return "";
  if (list.length === 1) return `New PR: ${prSetText(list[0], unit)}`;
  if (list.length === 2) return `New PRs: ${prSetText(list[0], unit)} and ${prSetText(list[1], unit)}`;
  return `New PRs: ${prSetText(list[0], unit)} and ${list.length - 1} more`;
}

/** "best ever at 5 reps" / "best ever for 1 rep": what the record beat (a record is per number of reps, lib/record-set.ts). */
export function prRepNote(reps: number): string {
  return reps === 1 ? "best ever for 1 rep" : `best ever at ${reps} reps`;
}

/** The coach's push after a client's workout: "Sam completed a workout. New PR: Back Squat 225 × 5" (or a group record, named the same way). */
export function workoutDonePushBody(athleteName: string, prs: PrSet[], groupRecords: PrSet[], unit: WeightUnit = "lb"): string {
  const done = `${athleteName} completed a workout`;
  if (groupRecords.length > 0) {
    const named = groupRecords.filter((p) => p.name.trim());
    const what = named.length === 1 ? prSetText(named[0], unit) : named.length > 1 ? `${prSetText(named[0], unit)} and ${named.length - 1} more` : "";
    return `${done}. New group record${named.length > 1 ? "s" : ""}${what ? `: ${what}` : ""} 🏆`;
  }
  const headline = prHeadline(prs, unit);
  return headline ? `${done}. ${headline} 🎉` : done;
}

/** The shared workout page's title: "Sam just hit a new PR: Back Squat 225 lbs × 5 🎉" (the card's own first record line), "and 2 more" past one. */
export function sharedPrTitle(athleteName: string, items: { name: string; primary: string }[]): string {
  const first = items[0];
  if (!first) return `${athleteName} just finished a workout! 💪`;
  const more = items.length > 1 ? ` and ${items.length - 1} more` : "";
  return `${athleteName} just hit a new PR: ${first.name} ${first.primary}${more} 🎉`;
}

/** Home's shout-out: "Sam just hit a new PR on Back Squat — worth a shoutout." ("on Back Squat and 1 more" past one). */
export function prShoutout(athleteName: string, liftNames: string[]): string {
  const names = liftNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return `${athleteName} just hit a new PR — worth a shoutout.`;
  const what = names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
  return `${athleteName} just hit a new PR on ${what} — worth a shoutout.`;
}
