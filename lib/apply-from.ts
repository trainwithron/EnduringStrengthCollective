import { addDaysToKey } from "@/lib/date-key";

// "Apply from": when a new standing target starts. Default today; up to 14 days ahead (never in the past: past days keep the target they had).
export const MAX_APPLY_AHEAD_DAYS = 14;

export function maxApplyFromKey(todayKey: string): string {
  return addDaysToKey(todayKey, MAX_APPLY_AHEAD_DAYS);
}

// A typed or picked date, held to today..today+14. Anything that is not a date becomes today.
export function clampApplyFrom(picked: string | null | undefined, todayKey: string): string {
  if (!picked || !/^\d{4}-\d{2}-\d{2}$/.test(picked)) return todayKey;
  if (picked < todayKey) return todayKey;
  const max = maxApplyFromKey(todayKey);
  return picked > max ? max : picked;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-14" -> "Oct 14", by the key's own parts (no Date, no zone).
export function shortDateLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : key;
}
