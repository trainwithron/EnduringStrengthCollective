import { afterEach, describe, expect, it, vi } from "vitest";

// Wave 2 C4 follow-up (Code Chat's review of 3234005a): the whole Google ask, token renewal included, has ONE time budget, and a Google copy of the coach's own session never
// blocks a time.
vi.mock("@/lib/google-calendar", () => ({
  isGoogleCalendarConfigured: () => true,
  // a token endpoint that never answers
  refreshGoogleCalendarTokens: () => new Promise(() => {}),
  fetchFreeBusy: async () => [{ start: "2026-11-21T15:00:00.000Z", end: "2026-11-21T16:00:00.000Z" }],
}));
vi.mock("@/lib/token-crypto", () => ({ openToken: (s: string) => s, tokenOwner: () => "owner", sealedTokenColumns: () => ({}) }));
vi.mock("@/lib/supabase/service-role", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    update: () => chain,
    maybeSingle: async () => ({ data: { id: "c1", coach_id: "coach", google_calendar_oauth_tokens: { access_token: "a", refresh_token: "r", expires_at: "2000-01-01T00:00:00Z" } } }),
  };
  return { createServiceRoleClient: () => ({ from: () => chain }) };
});

import { GOOGLE_BUSY_TIMEOUT_MS, googleBusyRanges, withoutOwnCopies } from "./google-busy";

afterEach(() => {
  vi.useRealTimers();
});

describe("one time budget for the whole ask", () => {
  it("a token renewal that hangs gives no Google times once the budget is spent, and never holds the page longer", async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = googleBusyRanges("coach", "2026-11-21T00:00:00Z", "2026-11-22T00:00:00Z").then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(GOOGLE_BUSY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([]);
    expect(settled).toBe(true);
  });
});

describe("Google copies of the coach's own sessions", () => {
  it("a busy time exactly equal to one of the coach's sessions is dropped; any other stays", () => {
    const at = (s: string) => new Date(s);
    const own = [{ start: at("2026-11-21T15:00:00Z"), end: at("2026-11-21T16:00:00Z") }];
    const google = [
      { id: "g1", start: at("2026-11-21T15:00:00Z"), end: at("2026-11-21T16:00:00Z") },
      { id: "g2", start: at("2026-11-21T15:00:00Z"), end: at("2026-11-21T15:30:00Z") },
      { id: "g3", start: at("2026-11-21T18:00:00Z"), end: at("2026-11-21T19:00:00Z") },
    ];
    expect(withoutOwnCopies(google, own).map((g) => g.id)).toEqual(["g2", "g3"]);
  });
});
