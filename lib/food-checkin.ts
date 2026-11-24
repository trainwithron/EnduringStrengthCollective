import { addDaysToKey } from "@/lib/timezone";
import { loggedDateKeys } from "@/lib/food-log-adherence";
import { isImportedFood } from "@/lib/imported-food";

// The food check-in (Ron, Nov 24: "build it"; the approved mockup is reports/nutrition-checkin-nudge-mockup.html). When a client stops logging food, or their logged calories run
// well off target, the coach's Nutrition Spotter sends the client a short check-in IN THE COACH'S NAME, and the answer comes back to the coach. The rules and every word of it
// are here (pure, tested); app/api/cron/food-checkins sends, app/api/food-checkins/* answer and handle. Nothing a client reads says AI, Spotter or automatic (the Clark Kent rule).

// ---- the rules ----

// Nothing logged on the 3 days before today (and nothing yet today).
export const QUIET_DAYS = 3;
// The last 7 full days: at least 4 logged, with their average calories (over the days with calories) more than 15% above or below the target.
export const OFF_WINDOW_DAYS = 7;
export const OFF_MIN_LOGGED_DAYS = 4;
export const OFF_SHARE = 0.15;
// At most one check-in per client per 7 days; one still unanswered after 7 days has expired (and a new one may follow).
export const CHECKIN_GAP_DAYS = 7;
// Sent at 10 in the morning of the client's own day (the job runs every hour).
export const CHECKIN_LOCAL_HOUR = 10;

export type CheckinTrigger = { kind: "quiet" } | { kind: "off"; avgDiffKcal: number; daysLogged: number; targetKcal: number };

export interface FoodRow {
  log_date: string;
  status?: string | null;
  food_source?: string | null;
  calories?: number | string | null;
}

// The 7 full days before today (today is not over: a morning with nothing yet must not count as a quiet day or pull an average down).
function daysBefore(todayKey: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDaysToKey(todayKey, -(i + 1)));
}

// Which check-in, if any (pure). `entries`: the client's food rows of the last 8 days or more, in this group. `everLoggedBefore`: they logged food at some point before the
// window; `targetSinceKey`: the first day of the target in force today (null: no target). Skipped meals and history brought in from another app never count (loggedDateKeys).
export function checkinTrigger(input: { entries: FoodRow[]; todayKey: string; targetKcal: number | null; targetSinceKey: string | null; everLoggedBefore: boolean }): CheckinTrigger | null {
  const { entries, todayKey, targetKcal } = input;
  if (targetKcal == null || !(targetKcal > 0)) return null;
  const logged = new Set(loggedDateKeys(entries as { log_date: string; status?: string | null; food_source?: string | null }[]));

  // quiet: nothing on the 3 days before today, nor today so far; only for someone who has logged before, or who has had a target for at least 3 days
  const quietDays = daysBefore(todayKey, QUIET_DAYS);
  if (!logged.has(todayKey) && quietDays.every((d) => !logged.has(d))) {
    const loggedEarlier = input.everLoggedBefore || [...logged].some((d) => d < quietDays[quietDays.length - 1]);
    const targetOldEnough = input.targetSinceKey != null && input.targetSinceKey <= addDaysToKey(todayKey, -QUIET_DAYS);
    return loggedEarlier || targetOldEnough ? { kind: "quiet" } : null;
  }

  // off: the last 7 full days
  const window = new Set(daysBefore(todayKey, OFF_WINDOW_DAYS));
  const daysLogged = [...logged].filter((d) => window.has(d)).length;
  if (daysLogged < OFF_MIN_LOGGED_DAYS) return null;
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const day = (e.log_date ?? "").slice(0, 10);
    const kcal = e.calories == null ? NaN : Number(e.calories);
    if (!window.has(day) || e.status === "skipped" || isImportedFood(e) || !Number.isFinite(kcal)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + kcal);
  }
  if (byDay.size === 0) return null;
  const avg = [...byDay.values()].reduce((s, v) => s + v, 0) / byDay.size;
  const diff = avg - targetKcal;
  if (Math.abs(diff) <= OFF_SHARE * targetKcal) return null;
  return { kind: "off", avgDiffKcal: Math.round(diff), daysLogged, targetKcal };
}

// May one be sent now (pure)? Never within 7 days of the last one, answered or not (an unanswered one is still open for those 7 days, then it has expired).
export function checkinAllowed(sentAts: (string | Date)[], now: Date): boolean {
  const cutoff = now.getTime() - CHECKIN_GAP_DAYS * 86400000;
  return sentAts.every((s) => new Date(s).getTime() <= cutoff);
}

// Still waiting on the client: sent, unanswered, not yet 7 days old.
export function checkinIsOpen(row: { status: string; sent_at: string }, now: Date): boolean {
  return row.status === "sent" && new Date(row.sent_at).getTime() > now.getTime() - CHECKIN_GAP_DAYS * 86400000;
}

// ---- the client's answer ----

export const CHECKIN_REASONS = [
  { key: "long_cook", label: "Meals take too long to cook", summary: "meals take too long to cook" },
  { key: "disliked_food", label: "There's food I don't like", summary: "there's food they don't like" },
  { key: "tracking_hassle", label: "Tracking is a hassle", summary: "tracking is a hassle" },
  { key: "rework_plan", label: "Please rework my plan", summary: "wants the plan reworked" },
  { key: "all_good", label: "All good, just busy", summary: "all good, just busy" },
] as const;
export type CheckinReason = (typeof CHECKIN_REASONS)[number]["key"];
export const CHECKIN_NOTE_MAX = 500;
const REASON_KEYS = new Set<string>(CHECKIN_REASONS.map((r) => r.key));

export function reasonLabel(key: string): string {
  return CHECKIN_REASONS.find((r) => r.key === key)?.label ?? key;
}

// What a save may write (pure): known chips only, each once, in the card's order; the note trimmed to 500. Null when there is nothing at all to send.
export function cleanCheckinAnswer(raw: unknown): { reasons: CheckinReason[]; note: string | null } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as { reasons?: unknown; note?: unknown };
  const picked = new Set(Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === "string" && REASON_KEYS.has(x)) : []);
  const reasons = CHECKIN_REASONS.map((x) => x.key).filter((k) => picked.has(k)) as CheckinReason[];
  const note = typeof r.note === "string" ? r.note.replace(/\r\n/g, "\n").trim().slice(0, CHECKIN_NOTE_MAX) : "";
  if (reasons.length === 0 && !note) return null;
  return { reasons, note: note || null };
}

// ---- the words ----

const firstName = (name: string | null | undefined, fallback: string): string => (name ?? "").trim().split(/\s+/)[0] || fallback;
// "about 400": the real average difference, rounded to 50 (never 0)
export const roundTo50 = (n: number): number => Math.max(50, Math.round(Math.abs(n) / 50) * 50);

// The client's push and bell, from the coach.
export function clientNotice(trigger: CheckinTrigger, coachName: string | null): { title: string; body: string; line: string } {
  const coach = firstName(coachName, "Your coach");
  const body =
    trigger.kind === "quiet"
      ? "Haven't seen your food in a few days. Everything OK with the plan?"
      : `Your calories have been running ${trigger.avgDiffKcal < 0 ? "low" : "high"} this week. Is the plan working for you?`;
  return { title: coach, body, line: `${coach}: ${body}` };
}

// The card's message, in the coach's voice.
export function cardMessage(row: { trigger: string; avg_diff_kcal: number | null }, clientName: string | null): string {
  const client = firstName(clientName, "there");
  if (row.trigger === "off" && row.avg_diff_kcal != null) {
    return `Hey ${client}, your calories have been running about ${roundTo50(row.avg_diff_kcal)} ${row.avg_diff_kcal < 0 ? "under" : "over"} your target this week. Is something not working with the plan?`;
  }
  return `Hey ${client}, I haven't seen your food in a few days. No stress, just checking in. Is something not working with the plan?`;
}

// The coach's pill on the client's nutrition page: "No food logged · 3 days" or "Calories −400/day · 5 of 7 days logged".
export function triggerPill(row: { trigger: string; avg_diff_kcal: number | null; days_logged: number | null }): string {
  if (row.trigger === "off" && row.avg_diff_kcal != null) {
    const sign = row.avg_diff_kcal < 0 ? "−" : "+";
    return `Calories ${sign}${roundTo50(row.avg_diff_kcal)}/day · ${row.days_logged ?? 0} of ${OFF_WINDOW_DAYS} days logged`;
  }
  return `No food logged · ${QUIET_DAYS} days`;
}

// The coach's own bell when one is sent: "Sent Robyn a food check-in: no food logged in 3 days".
export function sentNotice(row: { trigger: string; avg_diff_kcal: number | null }, clientName: string | null): string {
  const client = (clientName ?? "").trim() || "your client";
  const why =
    row.trigger === "off" && row.avg_diff_kcal != null
      ? `calories about ${roundTo50(row.avg_diff_kcal)} ${row.avg_diff_kcal < 0 ? "under" : "over"} target`
      : `no food logged in ${QUIET_DAYS} days`;
  return `Sent ${client} a food check-in: ${why}`;
}

// The coach's bell when the client answers: "Robyn answered your food check-in: wants the plan reworked."
export function answeredSummary(answer: { reasons: string[]; note: string | null }): string {
  if (answer.reasons.includes("rework_plan")) return "wants the plan reworked";
  const parts = CHECKIN_REASONS.filter((r) => answer.reasons.includes(r.key)).map((r) => r.summary);
  if (parts.length > 0) return parts.join(", ");
  return "wrote back";
}

export function answeredNotice(answer: { reasons: string[]; note: string | null }, clientName: string | null): string {
  const client = (clientName ?? "").trim() || "Your client";
  return `${client} answered your food check-in: ${answeredSummary(answer)}.`;
}

// What the rebuild is asked for: the meal plan builder's "Favorite foods / specific requests" box, comma-separated, the same as the recalc prompt's "Rebuild with their requests"
// (lib/meal-plan-rebuild.ts). The chips that ask for something, then the client's own words.
export function reworkRequests(answer: { reasons: string[]; note: string | null }): string {
  const asks: string[] = [];
  if (answer.reasons.includes("long_cook")) asks.push("quick meals with short cook times");
  if (answer.reasons.includes("disliked_food")) asks.push("leave out foods they don't like");
  if (answer.reasons.includes("tracking_hassle")) asks.push("simple meals that are easy to log");
  if (answer.note) asks.push(answer.note.replace(/\s+/g, " ").trim());
  return asks.join(", ").slice(0, 1000);
}

// ---- where the notices open ----

export const FOOD_CHECKIN_ANCHOR = "food-checkin";
// the client's own nutrition page, where the card is
export const clientCheckinPath = (groupId: string) => `/groups/${groupId}/nutrition#${FOOD_CHECKIN_ANCHOR}`;
// the coach's nutrition view of that client, at the Nutrition Spotter's check-in
export const coachCheckinPath = (groupId: string, athleteId: string) => `/groups/${groupId}/nutrition?athleteId=${athleteId}#${FOOD_CHECKIN_ANCHOR}`;
