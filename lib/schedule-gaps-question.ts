// The Scheduling Spot's gap question (Ron, Oct 6). It used to list one line per unbooked window ("Your Monday, Tuesday, Wednesday... has gone unbooked for six
// straight weeks"). Now it is one friendly question, asked rarely, and it remembers the answer:
//   ask       "You have gaps in your schedule. Are you looking to fill them, or happy where you are?"
//             -> "Looking to fill them" / "Happy where I am" (quiet for 6 months) / "Not now" (quiet for 2 weeks)
//   followup  after "fill them": "What kind of clients would you like: online, hybrid or in person?" (the answer is kept, ready for the coach finder and
//             marketplace client-acquisition work later; nothing is built on it yet), then quiet for 3 months.
// The answers are the coach's own feedback rows (kind "calendar"); no new table.

export const GAPS_KEY = "schedule_gaps::all";
export const GAPS_CLIENTS_KEY = "schedule_gaps::clients";
export const HAPPY_QUIET_DAYS = 180;
export const LATER_DAYS = 14;
export const ANSWERED_QUIET_DAYS = 90;
const DAY = 86400000;

export type ClientKind = "online" | "hybrid" | "in_person";
export const CLIENT_KINDS: { id: ClientKind; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "hybrid", label: "Hybrid" },
  { id: "in_person", label: "In person" },
];

export interface GapAnswerEvent {
  key: string;
  detail: string | null;
  at: string;
}

export type GapQuestionStage = "ask" | "followup" | "quiet";

function latest(events: GapAnswerEvent[], key: string): GapAnswerEvent | null {
  return events.filter((e) => e.key === key).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0] ?? null;
}

const within = (e: GapAnswerEvent, days: number, now: Date) => now.getTime() - new Date(e.at).getTime() < days * DAY;

export function scheduleGapsStage(events: GapAnswerEvent[], now: Date): GapQuestionStage {
  const g = latest(events, GAPS_KEY);
  const c = latest(events, GAPS_CLIENTS_KEY);
  if (!g) return "ask";
  if (g.detail === "happy") return within(g, HAPPY_QUIET_DAYS, now) ? "quiet" : "ask";
  if (g.detail === "later") return within(g, LATER_DAYS, now) ? "quiet" : "ask";
  if (g.detail === "fill") {
    if (c && new Date(c.at).getTime() > new Date(g.at).getTime()) {
      if (c.detail === "later") return within(c, LATER_DAYS, now) ? "quiet" : "followup";
      return within(c, ANSWERED_QUIET_DAYS, now) ? "quiet" : "ask";
    }
    return "followup";
  }
  return "ask";
}

// What kind of clients the coach said they want (for later client-acquisition work): the latest real answer, or null.
export function wantedClientKind(events: GapAnswerEvent[]): ClientKind | null {
  const c = latest(events, GAPS_CLIENTS_KEY);
  return c && (c.detail === "online" || c.detail === "hybrid" || c.detail === "in_person") ? c.detail : null;
}

export const ASK_HEADLINE = "You have gaps in your schedule. Are you looking to fill them, or happy where you are?";
export const FOLLOWUP_HEADLINE = "What kind of clients are you hoping to add?";
