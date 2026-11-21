// The weekly check-in (Ron, Nov 20: R2). A client answers two 1 to 5 questions and two short ones once a week, on top of a card filled in from what they already logged; their coach
// reads it on Check-ins, replies (a direct message) and marks it reviewed. This file is the rules and the words, with no database, so it is tested; the reads are
// lib/weekly-checkin-server.ts and the table is migration 0459 (step 215).
import { addDaysToKey } from "@/lib/timezone";
import { coachFirstName } from "@/lib/client-home-greeting";

export const CHECKIN_PATH_SUFFIX = "check-in";
export const COACH_CHECKINS_PATH = "/clients/check-ins";
export const checkinPath = (groupId: string) => `/groups/${groupId}/${CHECKIN_PATH_SUFFIX}`;

export const CHECKIN_TEXT_MAX = 2000;
export const CHECKIN_PHOTOS_MAX = 6;

export const ENERGY_QUESTION = "How was your energy this week?";
export const EATING_QUESTION = "How well did you stick to your eating?";
export const WIN_LABEL = "Biggest win this week";
export const HARD_LABEL = "What was hard?";
export const AUTO_FILL_LINE = "Filled in from your logs. Answer the rest in about a minute.";

// What the app fills in from the client's own logs that week.
export interface CheckinSnapshot {
  workouts_done: number;
  // Planned on the calendar that week (0: nothing was scheduled by date, then only the number done is shown).
  workouts_planned: number;
  // The average of the week's weigh-ins, one decimal (null: none logged).
  avg_weight: number | null;
  // The same for the week before, for the coach's change chip.
  prev_avg_weight: number | null;
  weight_unit: "lb" | "kg";
  // Days of the 7 with any food logged.
  food_days: number;
}

const dayOfWeek = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

// The Monday a week starts on.
export function mondayOf(dateKey: string): string {
  const dow = dayOfWeek(dateKey);
  return addDaysToKey(dateKey, dow === 0 ? -6 : 1 - dow);
}

// The week a check-in sent today is about: this week, except on a Monday, when the week that just ended is the one to look back on (the card on Home shows Friday through Monday).
export function checkinWeekStart(todayKey: string): string {
  return dayOfWeek(todayKey) === 1 ? addDaysToKey(todayKey, -7) : mondayOf(todayKey);
}

// Home shows the check-in card Friday, Saturday, Sunday and Monday while this week's is not sent.
export function isCheckinCardDay(todayKey: string): boolean {
  return [5, 6, 0, 1].includes(dayOfWeek(todayKey));
}

export function weekKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
}

// "Nov 16"
export function shortDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// "Coach Ron", or "your coach" when the coach's name says nothing.
export function coachLabel(coachFullName: string | null | undefined): string {
  const first = coachFirstName(coachFullName);
  return first && first !== "Unknown" ? `Coach ${first}` : "your coach";
}

// "Week of Nov 16 · for Coach Ron"
export function checkinSubline(weekStart: string, coachFullName: string | null | undefined): string {
  return `Week of ${shortDateLabel(weekStart)} · for ${coachLabel(coachFullName)}`;
}

export function sendLabel(coachFullName: string | null | undefined): string {
  const label = coachLabel(coachFullName);
  return `Send to ${label === "your coach" ? "your coach" : label}`;
}

export function roundWeight(n: number): number {
  return Math.round(n * 10) / 10;
}

export function averageWeight(weights: (number | string | null | undefined)[]): number | null {
  const nums = weights.map((w) => (w == null || w === "" ? NaN : Number(w))).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  return roundWeight(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// "3 of 4", or "3" when nothing was planned by date that week.
export function workoutsValue(s: Pick<CheckinSnapshot, "workouts_done" | "workouts_planned">): string {
  return s.workouts_planned > 0 ? `${s.workouts_done} of ${s.workouts_planned}` : `${s.workouts_done}`;
}

// The change in average weight from the week before, one decimal, with a real minus sign ("−1.2", "+0.8", "0.0"). Null without both weeks.
export function weightChange(s: Pick<CheckinSnapshot, "avg_weight" | "prev_avg_weight">): string | null {
  if (s.avg_weight == null || s.prev_avg_weight == null) return null;
  const d = roundWeight(s.avg_weight - s.prev_avg_weight);
  if (d === 0) return "0.0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}

// A 1 to 5 answer of 2 or less is worth the coach's eye (the coral chip).
export const isLowAnswer = (n: number | null | undefined) => n != null && n <= 2;

// What a client may send: two whole answers from 1 to 5 (both needed), the two texts trimmed (blank is none) and cut to the limit, and up to six photo ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanCheckin(raw: unknown): { ok: true; value: { energy: number; eating: number; win: string | null; hard: string | null; photo_ids: string[] } } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const score = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);
  const energy = score(r.energy);
  const eating = score(r.eating);
  if (energy == null || eating == null) return { ok: false, error: "Pick a number for both questions." };
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, CHECKIN_TEXT_MAX) : "") || null;
  const photos = Array.isArray(r.photoIds) ? [...new Set(r.photoIds.filter((p): p is string => typeof p === "string" && UUID.test(p)))].slice(0, CHECKIN_PHOTOS_MAX) : [];
  return { ok: true, value: { energy, eating, win: text(r.win), hard: text(r.hard), photo_ids: photos } };
}

// A stored snapshot read back (anything missing or odd reads as nothing).
export function readSnapshot(raw: unknown): CheckinSnapshot {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const whole = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    workouts_done: whole(r.workouts_done),
    workouts_planned: whole(r.workouts_planned),
    avg_weight: num(r.avg_weight),
    prev_avg_weight: num(r.prev_avg_weight),
    weight_unit: r.weight_unit === "kg" ? "kg" : "lb",
    food_days: Math.min(7, whole(r.food_days)),
  };
}

// When it was sent, in the coach's time zone: "Sent today, 8:14 AM", "Sent yesterday, 6:02 PM", "Sent Thu, Nov 19, 9:00 AM" (withTime) or without the time for the folded rows.
export function sentLabel(iso: string, timeZone: string, now: Date = new Date(), withTime = true): string {
  const when = new Date(iso);
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(now);
  const sent = dayKey(when);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(when);
  let day: string;
  if (sent === today) day = "today";
  else if (sent === addDaysToKey(today, -1)) day = "yesterday";
  else day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(when);
  return withTime ? `Sent ${day}, ${time}` : `Sent ${day}`;
}

// The folded row's line: "Sent yesterday · Energy 5 · Eating 4"
export function foldedLine(c: { submittedAt: string; energy: number; eating: number }, timeZone: string, now: Date = new Date()): string {
  return `${sentLabel(c.submittedAt, timeZone, now, false)} · Energy ${c.energy} · Eating ${c.eating}`;
}

// The push and the notice the coach gets when a check-in comes in (the first send of the week; a change to it does not ping them again).
export function coachNotice(clientName: string): { title: string; body: string; notice: string } {
  const name = clientName.trim() || "A client";
  return { title: `${name} sent their weekly check-in`, body: "Open Check-ins to read it and reply.", notice: `${name} sent their weekly check-in.` };
}

// The reminder a coach sends to clients who have not sent theirs (one push each).
export function reminderPush(coachFullName: string | null | undefined): { title: string; body: string } {
  const label = coachLabel(coachFullName);
  return { title: "Your weekly check-in", body: `${label === "your coach" ? "Your coach" : label} would like your check-in for this week. It takes about a minute.` };
}

export const REMIND_LIMIT_SECONDS = 24 * 60 * 60;
