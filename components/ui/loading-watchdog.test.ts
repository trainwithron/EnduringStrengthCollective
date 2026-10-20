import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldRefresh, markerOnScreen, MAX_REFRESHES_PER_PAGE, REFRESH_AFTER_MS, SECOND_REFRESH_AFTER_MS } from "./loading-watchdog";

// Oct 20 outage: one open /dashboard tab refreshed every ~5 s nonstop (the watchdog reset itself whenever the loading screen went away, and under load every refresh brought it back),
// ~680 database requests a minute, and the site timed out for everyone.
const src = readFileSync(join(__dirname, "loading-watchdog.tsx"), "utf8").replace(/\r\n/g, "\n");
const base = { visible: true, embedded: false };

describe("the loading watchdog can never loop", () => {
  it("refreshes after 5 s on screen, a second time after 10 s more, and never a third time for the same page", () => {
    expect(shouldRefresh({ ...base, stuckForMs: REFRESH_AFTER_MS - 1, refreshesDone: 0 })).toBe(false);
    expect(shouldRefresh({ ...base, stuckForMs: REFRESH_AFTER_MS, refreshesDone: 0 })).toBe(true);
    expect(shouldRefresh({ ...base, stuckForMs: REFRESH_AFTER_MS, refreshesDone: 1 })).toBe(false);
    expect(shouldRefresh({ ...base, stuckForMs: SECOND_REFRESH_AFTER_MS, refreshesDone: 1 })).toBe(true);
    expect(MAX_REFRESHES_PER_PAGE).toBe(2);
    expect(shouldRefresh({ ...base, stuckForMs: 60_000, refreshesDone: 2 })).toBe(false);
  });
  it("the count is per page and kept for the life of the tab: the loading screen coming back never resets it", () => {
    expect(src).toContain("const refreshesByPage = new Map<string, number>();");
    expect(src).toContain("const page = `${pathname}${window.location.search}`;");
    expect(src).toContain("refreshesByPage.set(page, done + 1);");
    // the old reset of the flags when the marker went away is gone
    expect(src).not.toMatch(/refreshedRef|reloadedRef/);
  });
  it("never in a hidden tab, never inside an embedded frame", () => {
    expect(shouldRefresh({ stuckForMs: 30_000, refreshesDone: 0, visible: false, embedded: false })).toBe(false);
    expect(shouldRefresh({ stuckForMs: 30_000, refreshesDone: 0, visible: true, embedded: true })).toBe(false);
    expect(src).toContain("if (isEmbeddedWindow()) return;");
    expect(src).toContain('visible: document.visibilityState === "visible"');
  });
  it("a loading marker inside something hidden does not count", () => {
    const el = (rects: number) => ({ getClientRects: () => ({ length: rects }) });
    expect(markerOnScreen({ querySelectorAll: () => [el(0)] } as unknown as ParentNode)).toBe(false);
    expect(markerOnScreen({ querySelectorAll: () => [el(0), el(1)] } as unknown as ParentNode)).toBe(true);
    expect(markerOnScreen({ querySelectorAll: () => [] } as unknown as ParentNode)).toBe(false);
  });
  it("never a hard reload", () => {
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("location.reload");
  });
});

describe("an idle open page makes no repeating requests", () => {
  it("Spotlight reads its counts only where its button is on screen, not in a frame or a hidden tab", () => {
    const hub = readFileSync(join(__dirname, "..", "coach", "mobile", "coach-spot-hub.tsx"), "utf8");
    expect(hub).toContain("if (isEmbeddedWindow()) return;");
    expect(hub).toContain('if (document.visibilityState !== "visible" || !triggerRef.current || triggerRef.current.getClientRects().length === 0) return;');
  });
  it("the timers left are slow and skip a hidden tab", () => {
    const auto = readFileSync(join(__dirname, "..", "coach", "desktop", "dashboard-auto-refresh.tsx"), "utf8");
    expect(auto).toContain("export const REFRESH_INTERVAL_MS = 120 * 1000;");
    expect(auto).toContain("return !input.hidden && !input.paused && input.now - input.lastRefreshAt >= MIN_GAP_MS;");
    expect(readFileSync(join(__dirname, "..", "coach", "desktop", "floating-messages.tsx"), "utf8")).toContain('if (!first && document.visibilityState !== "visible") return;');
    expect(readFileSync(join(__dirname, "..", "messages", "use-inbox-refresh.ts"), "utf8")).toContain('if (typeof document !== "undefined" && document.visibilityState !== "visible") return;');
  });
});
