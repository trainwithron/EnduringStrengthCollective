import { wallClockOf } from "@/lib/series-schedule";

// What the client sees on "My schedule" (pause, freeze, cancel). Plain words, sentence case, never about money, credits or what is owed. Dates are the schedule's own
// calendar days ("2026-11-03"), written for people ("Nov 3"); nothing here converts a time zone except the one "today" for the date picker.
export type RequestKind = "pause" | "freeze" | "cancel";
export type SeriesStatus = "active" | "paused" | "ended" | "cancelled";
export type RequestStatus = "pending" | "applying" | "applied" | "dismissed" | "withdrawn";

export interface SeriesForUi {
  id: string;
  weekday: number;
  startTime: string; // "06:00" or "06:00:00", in the schedule's own zone
  durationMinutes: number;
  status: SeriesStatus;
  timezone: string | null;
  frozenUntil: string | null; // "YYYY-MM-DD"
  endsOn: string | null;
}

export interface RequestForUi {
  id: string;
  seriesId: string;
  kind: RequestKind;
  effectiveOn: string;
  resumeOn: string | null;
  status: RequestStatus;
  createdAt: string; // ISO instant
  appliedAt: string | null;
  appliedEarly: boolean;
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function timeLabel(startTime: string): string {
  const [h, m] = startTime.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return startTime;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "Tuesdays at 6:00 AM, 60 minutes"
export function scheduleSummary(s: Pick<SeriesForUi, "weekday" | "startTime" | "durationMinutes">): string {
  return `${DAYS[s.weekday] ?? "Weekly"} at ${timeLabel(s.startTime)}, ${s.durationMinutes} minutes`;
}

// "2026-11-03" -> "Nov 3" (no time zone involved: it is a calendar day)
export function dayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map((n) => Number(n));
  if (!m || !d) return dateKey;
  return `${MONTHS[m - 1]} ${d}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map((n) => Number(n));
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// "Active", "Paused", "Frozen until Nov 3", "Ended Nov 3"
export function scheduleStateLine(s: Pick<SeriesForUi, "status" | "frozenUntil" | "endsOn">): string {
  if (s.status === "active") return "Active";
  if (s.status === "paused") return s.frozenUntil ? `Frozen until ${dayLabel(s.frozenUntil)}` : "Paused";
  return s.endsOn ? `Ended ${dayLabel(s.endsOn)}` : "Ended";
}

// Which of the three the client may ask for: a running schedule can be paused, frozen or cancelled; a paused one can only be cancelled; an ended one nothing.
export function requestableKinds(status: SeriesStatus): RequestKind[] {
  if (status === "active") return ["pause", "freeze", "cancel"];
  if (status === "paused") return ["cancel"];
  return [];
}

// The date picker's earliest day: today in the schedule's own zone (the database refuses an earlier day).
export function todayKey(timezone: string | null, now: Date = new Date()): string {
  return wallClockOf(now, timezone ?? "America/New_York").dateKey;
}

export function freezeLengthOptions(effectiveOn: string): { label: string; resumeOn: string }[] {
  return [1, 2, 4, 8, 12].map((weeks) => ({ label: weeks === 1 ? "1 week" : `${weeks} weeks`, resumeOn: addDays(effectiveOn, weeks * 7) }));
}

export const OVERDUE_HOURS = 48;

export function openRequest(requests: RequestForUi[], seriesId?: string): RequestForUi | null {
  return requests.find((r) => (r.status === "pending" || r.status === "applying") && (!seriesId || r.seriesId === seriesId)) ?? null;
}

// A request nobody has answered for about two days: the client is told, and offered a one-tap message to their coach.
export function isOverdue(r: Pick<RequestForUi, "status" | "createdAt">, now: Date = new Date()): boolean {
  return r.status === "pending" && now.getTime() - new Date(r.createdAt).getTime() >= OVERDUE_HOURS * 3600000;
}

const KIND_PHRASE: Record<RequestKind, string> = { pause: "pause", freeze: "freeze", cancel: "end" };

// What the status of one request says, in plain words. `sentOn` is the day the request was sent, written for the client's own calendar ("Oct 8").
export function requestStatusLine(r: RequestForUi, sentOn: string, now: Date = new Date()): string {
  const through = dayLabel(r.effectiveOn);
  switch (r.status) {
    case "pending":
    case "applying":
      return isOverdue(r, now)
        ? `Request sent ${sentOn}: ${KIND_PHRASE[r.kind]} after ${through}. Your coach hasn't replied yet.`
        : `Request sent ${sentOn}: ${KIND_PHRASE[r.kind]} after ${through}. Your coach will reach out.`;
    case "applied":
      if (r.kind === "pause") return "Your weekly schedule is paused. Your coach will be in touch about starting again.";
      if (r.kind === "freeze") {
        // A freeze whose restart day had already passed when it was applied froze nothing.
        if (r.resumeOn && r.appliedAt && r.resumeOn <= r.appliedAt.slice(0, 10)) return "The freeze you asked for had already ended, so your weekly schedule was left as it is.";
        return r.resumeOn ? `Your weekly schedule is frozen. It starts again ${dayLabel(r.resumeOn)}.` : "Your weekly schedule is frozen.";
      }
      return "Your weekly schedule has ended. Thank you for training with us.";
    case "dismissed":
      return "Your coach has handled this request.";
    case "withdrawn":
      return "You took this request back.";
  }
}

// The one sentence on each sheet: what happens, and who reaches out. Never about money or sessions owed.
export const SHEET_COPY: Record<RequestKind, { title: string; intro: string; dateLabel: string; button: string }> = {
  pause: {
    title: "Request a pause",
    intro: "Your sessions after that day come off the calendar. Your coach will reach out.",
    dateLabel: "Pause after",
    button: "Send pause request",
  },
  freeze: {
    title: "Request a freeze",
    intro: "Your sessions come off the calendar until you start again. Your coach will reach out.",
    dateLabel: "Freeze after",
    button: "Send freeze request",
  },
  cancel: {
    title: "Request to cancel",
    intro: "Sorry to see you go. Your sessions after that day end, and your coach will be in touch.",
    dateLabel: "Last day of sessions",
    button: "Send cancel request",
  },
};
