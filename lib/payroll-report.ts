import { estimateCents, MAX_RATE_CENTS, type CoachActivity, type CoachActivityRow, type SessionLine } from "@/lib/coach-activity";
import { csvLine } from "@/lib/zip-store";
import { dateKeyInZone } from "@/lib/timezone";

// A saved pay period ($3, Ron Nov 20): the Coach activity table for a period, frozen as it was shown, with the rates the owner typed and the pay line each makes, and the sessions
// behind the numbers. Stored once (payroll_reports, migration 0464) and never changed, so a session moved or marked later does not change a saved report. An estimate to check
// against pay, as on the page: nothing is paid from here.
export interface PayrollRow extends CoachActivityRow {
  rateCents: number;
  estimateCents: number;
}

export interface PayrollSnapshot {
  version: 1;
  period: { fromDay: string; toDay: string; timeZone: string };
  rows: PayrollRow[];
  totals: { sessionsDelivered: number; estimateCents: number };
  sessionLines: (SessionLine & { estimateCents: number })[];
  creditsSold: number;
}

export interface SavedPayrollReport {
  id: string;
  created_at: string;
  created_by: string | null;
  from_day: string;
  to_day: string;
  time_zone: string;
  note: string | null;
  snapshot: PayrollSnapshot;
}

export const NOTE_MAX = 1000;

// The rates as the page sends them (whole cents per coach); anything that is not a whole number of cents within the page's own limit counts as no rate, exactly as on the page.
export function cleanRates(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (/^[0-9a-f-]{36}$/i.test(k) && Number.isInteger(n) && n > 0 && n <= MAX_RATE_CENTS) out[k] = n;
  }
  return out;
}

export function cleanNote(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().slice(0, NOTE_MAX);
  return t || null;
}

export function buildPayrollSnapshot(activity: Pick<CoachActivity, "rows" | "sessionLines" | "creditsSold">, period: { fromDay: string; toDay: string; timeZone: string }, rates: Record<string, number>): PayrollSnapshot {
  const rate = (coachId: string) => rates[coachId] ?? 0;
  const rows = activity.rows.map((r) => ({ ...r, rateCents: rate(r.coachId), estimateCents: estimateCents(r.sessionsDelivered, rate(r.coachId)) }));
  return {
    version: 1,
    period: { fromDay: period.fromDay, toDay: period.toDay, timeZone: period.timeZone },
    rows,
    totals: { sessionsDelivered: rows.reduce((n, r) => n + r.sessionsDelivered, 0), estimateCents: rows.reduce((n, r) => n + r.estimateCents, 0) },
    sessionLines: activity.sessionLines.map((s) => ({ ...s, estimateCents: rate(s.coachId) })),
    creditsSold: activity.creditsSold,
  };
}

export const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The saved report as a spreadsheet: the per-coach pay lines first, then every session behind them, then what it is.
export function payrollCsv(report: Pick<SavedPayrollReport, "created_at" | "note" | "snapshot">): string {
  const s = report.snapshot;
  const tz = s.period.timeZone;
  const lines: string[] = [];
  lines.push(csvLine(["pay_period_from", "pay_period_to", "time_zone", "saved_on", "note"]));
  lines.push(csvLine([s.period.fromDay, s.period.toDay, tz, dateKeyInZone(tz, new Date(report.created_at)), report.note ?? ""]));
  lines.push(csvLine([]));
  lines.push(csvLine(["coach", "role", "clients", "sessions", "no_shows", "late_cancels", "rate_per_session_cents", "estimate_cents"]));
  for (const r of s.rows) lines.push(csvLine([r.name, r.role, r.clients, r.sessionsDelivered, r.noShows, r.lateCancels, r.rateCents, r.estimateCents]));
  lines.push(csvLine(["Everyone", "", "", s.totals.sessionsDelivered, "", "", "", s.totals.estimateCents]));
  lines.push(csvLine([]));
  lines.push(csvLine(["coach", "date", "time_zone", "client", "session_type", "booking_id", "estimate_cents"]));
  for (const l of s.sessionLines) lines.push(csvLine([l.coachName, dateKeyInZone(tz, new Date(l.startAt)), tz, l.clientName, l.sessionType, l.bookingId, l.estimateCents]));
  lines.push(csvLine([`Days run midnight to midnight in ${tz}. Saved as it was shown; it does not change when sessions change later.`]));
  lines.push(csvLine(["Estimate only, not payroll. Sessions delivered = confirmed, time passed, not a no-show. Clients private from the organization are not included."]));
  return "﻿" + lines.join("");
}
