// What a PR notice says (wave 2, P3; Ron, Nov 20): the lift, the weight and the reps, never a bare "new PR!" ("'Client achieved personal best' - Great but WHAT?").
// One place for the words, so the coach's push, the share card and Home's shout-out always say it the same way. Weights are written as they are stored (pounds),
// with no unit, the way the logger's "Last time 135 × 8" line writes them: "New PR: Back Squat 225 × 5".

export interface PrSet {
  name: string;
  weight: number | null; // null for a record that is not a weight (a distance, a time) or whose set could not be read
  reps: number | null;
}

const num = (n: number) => String(Number(n.toFixed(2)));

/** "Back Squat 225 × 5", or just "Back Squat" when the set is not known. */
export function prSetText(pr: PrSet): string {
  const name = pr.name.trim();
  if (pr.weight != null && pr.weight > 0 && pr.reps != null && pr.reps > 0) return `${name} ${num(pr.weight)} × ${pr.reps}`;
  return name;
}

/** "New PR: Back Squat 225 × 5"; with more than one, "New PRs: Back Squat 225 × 5 and Bench Press 185 × 8", or "... and 2 more" past two. Empty for none. */
export function prHeadline(prs: PrSet[]): string {
  const list = prs.filter((p) => p.name.trim());
  if (list.length === 0) return "";
  if (list.length === 1) return `New PR: ${prSetText(list[0])}`;
  if (list.length === 2) return `New PRs: ${prSetText(list[0])} and ${prSetText(list[1])}`;
  return `New PRs: ${prSetText(list[0])} and ${list.length - 1} more`;
}

/** "best ever at 5 reps" / "best ever for 1 rep": what the record beat (a record is per number of reps, lib/record-set.ts). */
export function prRepNote(reps: number): string {
  return reps === 1 ? "best ever for 1 rep" : `best ever at ${reps} reps`;
}

/** The coach's push after a client's workout: "Sam completed a workout. New PR: Back Squat 225 × 5" (or a group record, named the same way). */
export function workoutDonePushBody(athleteName: string, prs: PrSet[], groupRecords: PrSet[]): string {
  const done = `${athleteName} completed a workout`;
  if (groupRecords.length > 0) {
    const named = groupRecords.filter((p) => p.name.trim());
    const what = named.length === 1 ? prSetText(named[0]) : named.length > 1 ? `${prSetText(named[0])} and ${named.length - 1} more` : "";
    return `${done}. New group record${named.length > 1 ? "s" : ""}${what ? `: ${what}` : ""} 🏆`;
  }
  const headline = prHeadline(prs);
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
