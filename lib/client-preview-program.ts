// Where a client is in a program, for the preview's "Your program" card and its full program view. Pure.
import { isLocked, type VisibilityWindow } from "@/lib/program-schedule";

export interface ProgramDay {
  id: string;
  title: string;
  weekNumber: number;
  date: Date | null;
  done: boolean;
}

export interface ProgramProgress {
  totalWeeks: number;
  totalDays: number;
  doneDays: number;
  finished: boolean;
  // The next workout still to do (the first not done, in program order), and where it sits.
  next: { title: string; weekNumber: number; dayInWeek: number; date: Date | null } | null;
}

export function programProgress(days: ProgramDay[]): ProgramProgress {
  const totalWeeks = days.reduce((m, d) => Math.max(m, d.weekNumber), 0);
  const doneDays = days.filter((d) => d.done).length;
  const nextIndex = days.findIndex((d) => !d.done);
  if (days.length === 0 || nextIndex < 0) return { totalWeeks, totalDays: days.length, doneDays, finished: days.length > 0, next: null };
  const next = days[nextIndex];
  const dayInWeek = days.filter((d, i) => d.weekNumber === next.weekNumber && i <= nextIndex).length;
  return { totalWeeks, totalDays: days.length, doneDays, finished: false, next: { title: next.title, weekNumber: next.weekNumber, dayInWeek, date: next.date } };
}

// "Week 3 of 12 · Day 2", or "Finished", or "Not started yet" (nothing done and no workouts).
export function progressLine(p: ProgramProgress): string {
  if (p.totalDays === 0) return "No workouts yet";
  if (p.finished) return "Finished";
  if (!p.next) return "Not started yet";
  return `Week ${p.next.weekNumber} of ${p.totalWeeks} · Day ${p.next.dayInWeek}`;
}

export type DayStatus = "done" | "available" | "locked";

// A workout's state for the client: done, available now (its date has come, or the program unlocks it ahead of time, or it has no date), or locked until its date.
export function dayStatus(day: ProgramDay, today: Date, window: VisibilityWindow): DayStatus {
  if (day.done) return "done";
  if (!day.date) return "available";
  return isLocked(day.date, today, window) ? "locked" : "available";
}
