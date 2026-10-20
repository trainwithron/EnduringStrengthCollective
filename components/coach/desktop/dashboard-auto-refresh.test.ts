import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldRefreshOnReturn, shouldRefreshOnTick, MIN_GAP_MS, HIDDEN_AT_LEAST_MS, REFRESH_INTERVAL_MS } from "./dashboard-auto-refresh";

// Oct 20 outage: Home re-rendered on EVERY return to the tab; a pane flipping hidden/visible every ~5 s made it a 5 s loop that filled the database's connections.
// A tab, simulated the way the component runs: a 2-minute timer and visibility changes, with the same two rules.
function simulate(events: { at: number; hidden: boolean }[], endAt: number): number[] {
  const refreshes: number[] = [];
  let lastRefreshAt = 0;
  let hidden = false;
  let hiddenSince: number | null = null;
  const timeline = [...events.map((e) => ({ ...e, kind: "vis" as const })), ...Array.from({ length: Math.floor(endAt / REFRESH_INTERVAL_MS) }, (_, i) => ({ at: (i + 1) * REFRESH_INTERVAL_MS, hidden: false, kind: "tick" as const }))].sort((a, b) => a.at - b.at);
  for (const e of timeline) {
    if (e.kind === "tick") {
      if (shouldRefreshOnTick({ now: e.at, lastRefreshAt, hidden, paused: false })) {
        lastRefreshAt = e.at;
        refreshes.push(e.at);
      }
      continue;
    }
    if (e.hidden) {
      hidden = true;
      if (hiddenSince === null) hiddenSince = e.at;
      continue;
    }
    hidden = false;
    const away = hiddenSince;
    hiddenSince = null;
    if (shouldRefreshOnReturn({ now: e.at, hiddenSince: away, lastRefreshAt, paused: false })) {
      lastRefreshAt = e.at;
      refreshes.push(e.at);
    }
  }
  return refreshes;
}

describe("Home's auto-refresh can never loop", () => {
  it("a pane flipping hidden/visible every 5 s for 10 minutes: at most one refresh per minute, and none from the flapping", () => {
    const events = Array.from({ length: 120 }, (_, i) => ({ at: i * 5000 + 2500, hidden: i % 2 === 0 }));
    const r = simulate(events, 10 * 60 * 1000);
    for (let i = 1; i < r.length; i++) expect(r[i] - r[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS);
    expect(r.length).toBeLessThanOrEqual(10);
  });
  it("back after less than a minute: no refresh", () => {
    expect(shouldRefreshOnReturn({ now: 200_000, hiddenSince: 200_000 - 59_000, lastRefreshAt: 0, paused: false })).toBe(false);
    expect(simulate([{ at: 30_000, hidden: true }, { at: 80_000, hidden: false }], 100_000)).toEqual([]);
  });
  it("back after a minute or more: one refresh, unless one ran in the last minute", () => {
    expect(shouldRefreshOnReturn({ now: 200_000, hiddenSince: 200_000 - HIDDEN_AT_LEAST_MS, lastRefreshAt: 0, paused: false })).toBe(true);
    expect(shouldRefreshOnReturn({ now: 200_000, hiddenSince: 100_000, lastRefreshAt: 170_000, paused: false })).toBe(false);
    expect(shouldRefreshOnReturn({ now: 200_000, hiddenSince: 100_000, lastRefreshAt: 0, paused: true })).toBe(false);
  });
  it("the 2-minute timer skips a hidden tab and keeps the one-minute gap", () => {
    expect(shouldRefreshOnTick({ now: 120_000, lastRefreshAt: 0, hidden: true, paused: false })).toBe(false);
    expect(shouldRefreshOnTick({ now: 120_000, lastRefreshAt: 100_000, hidden: false, paused: false })).toBe(false);
    expect(shouldRefreshOnTick({ now: 120_000, lastRefreshAt: 0, hidden: false, paused: false })).toBe(true);
  });
});

describe("Home does not prefetch every client link at once", () => {
  it("per-client links on Home load on tap only", () => {
    const root = join(__dirname, "..", "..", "..");
    for (const f of [
      "components/coach/desktop/needs-reply-panel.tsx",
      "components/coach/desktop/org-notifications-panel.tsx",
      "components/coach/desktop/your-day-panel.tsx",
      "components/coach/desktop/needs-payment-panel.tsx",
      "components/coach/schedule-requests-panel.tsx",
      "components/coach/expiry-checkin-panel.tsx",
      "components/coach/inactive-clients-panel.tsx",
      "components/coach/progress-look-panel.tsx",
      "components/coach/next-client-workout-section.tsx",
      "components/coach/desktop/home-client-card.tsx",
      "components/coach/desktop/home-group-card.tsx",
      "components/coach/desktop/pulse-tabs.tsx",
      "components/coach/desktop/needs-you-strip.tsx",
      "components/coach/desktop/team-pulse-card.tsx",
    ]) {
      const s = readFileSync(join(root, f), "utf8");
      const links = s.match(/<Link\s/g)?.length ?? 0;
      expect(links, f).toBeGreaterThan(0);
      expect(s.match(/<Link prefetch=\{false\}/g)?.length ?? 0, f).toBe(links);
    }
  });
});
