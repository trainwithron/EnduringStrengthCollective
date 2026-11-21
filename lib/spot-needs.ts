// What the Spotlight button carries on a coach's phone (Ron, Oct 19: "that could be our notification bell ... just like a dull fading in and out. Or a dot."):
// what "Waiting for you" lists, for the organization the coach is working in: requests waiting on the coach's answer (sessions asked for or moved, late cancels and moves, weekly-schedule
// changes, people asking to train), weekly check-ins to review, sessions waiting for "did it happen" and unread notices. The button shows a small dot with the count when there is anything;
// when something NEW arrived since the coach last opened Spotlight it fades in and out gently twice, then stays a dot.
// One number everywhere (Nov 21, PH1): the dot, "Waiting for you (n)" and the app icon's badge all show spotCount. One thing counts once (PH2): a message counts by its notice (the fold
// lists the notice, not the message), and a notice about a request or a check-in is not counted again beside the request or check-in it is about.
import { REQUEST_NOTICE_TYPES } from "@/lib/notice-links";

export interface SpotNotice {
  id: string;
  type: string;
  body: string;
  linkPath: string;
  createdAt: string;
}

export interface SpotNeeds {
  needsChoice: boolean;
  groupIds: string[];
  timezone: string;
  sessionsToCheck: { bookingId: string; athleteId: string; groupId: string; name: string; startIso: string }[];
  // startHref: the workout itself when the client's Log page would offer exactly one "Start" (PH24); otherwise null and the button opens the Log page.
  next: { athleteId: string; groupId: string; startIso: string; name: string; hasProgram: boolean; startHref?: string | null } | null;
  open: { sessionId: string; athleteId: string; groupId: string; startedIso: string; name: string } | null;
  notices: SpotNotice[];
  // The Requests page's own "waiting" number (PH1, PH3); 0 when it could not be read.
  requestsWaiting: number;
  // Weekly check-ins waiting for review, as the Check-ins page counts them; 0 when it could not be read.
  checkinsToReview: number;
  count: number;
  // The newest thing counted (an ISO time), so the button can tell whether something arrived since it was last opened.
  newestAt: string | null;
}

// Notices already counted by their own row: the request or the check-in they are about.
const COUNTED_ELSEWHERE = new Set<string>([...REQUEST_NOTICE_TYPES, "weekly_checkin"]);

export function countedNotices(notices: Pick<SpotNotice, "type">[]): number {
  return notices.filter((n) => !COUNTED_ELSEWHERE.has(n.type)).length;
}

export function spotCount(n: Pick<SpotNeeds, "sessionsToCheck" | "notices" | "requestsWaiting" | "checkinsToReview">): number {
  return n.sessionsToCheck.length + countedNotices(n.notices) + Math.max(0, n.requestsWaiting || 0) + Math.max(0, n.checkinsToReview || 0);
}

// The workout "Start <name>'s workout" opens straight into (PH24): only when the Log page would offer exactly one "Start" choice; otherwise null (the Log page, which offers the choice).
export function soleStartWorkoutId(choices: { kind: string; workoutId: string | null }[]): string | null {
  const starts = choices.filter((c) => c.kind === "start" && !!c.workoutId);
  return starts.length === 1 ? starts[0].workoutId : null;
}

export function newestOf(times: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const t of times) if (t && (!best || t > best)) best = t;
  return best;
}

// The gentle fade only for something newer than the last time Spotlight was opened (and never when the person asked for less motion).
export function shouldFade(newestAt: string | null, lastOpenedAt: string | null, reducedMotion: boolean): boolean {
  if (reducedMotion || !newestAt) return false;
  return !lastOpenedAt || newestAt > lastOpenedAt;
}

export const SPOT_LAST_OPENED_KEY = "spot-last-opened";

// One read at a time: Spotlight and the app icon's badge (components/coach/app-badge-sync.tsx) ask at the same moment when a page opens, and share the one answer. Null when it failed
// or took longer than 15 seconds. `full`: opening Spotlight also works out where "Start <name>'s workout" goes (next.startHref, ?full=1); the dot and the badge need only the count.
// A full read answers a plain ask too; a plain one in flight does not answer a full ask.
export const SPOT_NEEDS_TIMEOUT_MS = 15_000;
let inflight: { full: boolean; request: Promise<SpotNeeds | null> } | null = null;
export function fetchSpotNeeds(full = false): Promise<SpotNeeds | null> {
  if (inflight && (inflight.full || !full)) return inflight.request;
  const request: Promise<SpotNeeds | null> = fetch(full ? "/api/coach/spot-needs?full=1" : "/api/coach/spot-needs", { cache: "no-store", signal: AbortSignal.timeout(SPOT_NEEDS_TIMEOUT_MS) })
    .then((r) => (r.ok ? (r.json() as Promise<SpotNeeds>) : null))
    .catch(() => null)
    .finally(() => {
      if (inflight?.request === request) inflight = null;
    });
  inflight = { full, request };
  return request;
}

// The number on the app icon for an answer: the same count as the dot (null when the coach still has to choose an organization: the icon is left as it was).
export function badgeCountOf(data: SpotNeeds | null): number | null {
  if (!data || data.needsChoice || typeof data.count !== "number") return null;
  return data.count;
}

// Moving from page to page on a phone, the dot is not asked for again within a minute (it was asked for on every page). Opening Spotlight always asks. Kept per tab (sessionStorage),
// for the organization it was read for, and cleared on sign-out.
export const SPOT_NEEDS_CACHE_KEY = "spot-needs-cache-v1";
export const SPOT_NEEDS_CACHE_MS = 60_000;

export function spotNeedsCacheEntry(data: SpotNeeds, org: string | null, now: number): string {
  return JSON.stringify({ at: now, org: org ?? null, data });
}

// The kept answer when it is under a minute old and for this organization; otherwise null (never a guess from a broken entry).
export function readSpotNeedsCache(raw: string | null, org: string | null, now: number): SpotNeeds | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as { at?: unknown; org?: unknown; data?: unknown };
    if (typeof e.at !== "number" || now - e.at < 0 || now - e.at >= SPOT_NEEDS_CACHE_MS) return null;
    if ((e.org ?? null) !== (org ?? null)) return null;
    const d = e.data as SpotNeeds | null;
    return d && typeof d === "object" && typeof d.count === "number" ? d : null;
  } catch {
    return null;
  }
}
