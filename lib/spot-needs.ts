// What the Spotlight button carries on a coach's phone (Ron, Oct 19: "that could be our notification bell ... just like a dull fading in and out. Or a dot."):
// sessions waiting for "did it happen", unread notices and unread messages, for the organization the coach is working in. The button shows a small dot with the count
// when there is anything; when something NEW arrived since the coach last opened Spotlight it fades in and out gently twice, then stays a dot.

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
  next: { athleteId: string; groupId: string; startIso: string; name: string; hasProgram: boolean } | null;
  open: { sessionId: string; athleteId: string; groupId: string; startedIso: string; name: string } | null;
  notices: SpotNotice[];
  unreadMessages: number;
  count: number;
  // The newest thing counted (an ISO time), so the button can tell whether something arrived since it was last opened.
  newestAt: string | null;
}

export function spotCount(n: Pick<SpotNeeds, "sessionsToCheck" | "notices" | "unreadMessages">): number {
  return n.sessionsToCheck.length + n.notices.length + Math.max(0, n.unreadMessages);
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
