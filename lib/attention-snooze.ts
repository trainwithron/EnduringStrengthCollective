// "Not now" on a Needs attention item: hidden for this client for a week, and back only if it is still true after. Pure, so it is tested.

export const SNOOZE_DAYS = 7;

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The last day an item stays hidden: a week from today ("2026-10-14" -> "2026-10-21").
export function snoozeUntil(today: Date, days: number = SNOOZE_DAYS): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return key(d);
}

// Hidden through the until date; from the next day it is judged again.
export function isSnoozed(untilDate: string | null | undefined, today: Date): boolean {
  return !!untilDate && key(today) <= untilDate.slice(0, 10);
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "this client";
}
