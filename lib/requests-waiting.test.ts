import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inDigestMorning, requestsWaitingLine } from "./requests-waiting";
import { applyAppBadge } from "@/components/coach/app-badge-sync";

// Wave 3 C10 (Ron, Nov 20): a daily "N requests waiting" line at the coach's morning (push, email when no phone), only when N > 0; and the waiting count on the app's icon.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the morning line", () => {
  it("says how many", () => {
    expect(requestsWaitingLine(1).body).toBe("1 request is waiting for your answer.");
    expect(requestsWaitingLine(3).body).toBe("3 requests are waiting for your answer.");
  });
  it("goes out from 8 AM in the coach's own clock, retried each hour until noon if nobody was reached", () => {
    expect(inDigestMorning(7)).toBe(false);
    expect(inDigestMorning(8)).toBe(true);
    expect(inDigestMorning(11)).toBe(true);
    expect(inDigestMorning(12)).toBe(false);
  });
  it("only when something is waiting, at most once in about a day, only a delivered line counts, push first then email, and not for a coach who switched Bookings off", () => {
    const job = read("app/api/cron/requests-digest/route.ts");
    expect(job).toContain("if (count <= 0 || off.has(coachId) || recent.has(coachId)) {");
    expect(job).toContain('.eq("kind", REQUESTS_DIGEST_KIND).gte("sent_at", since)');
    expect(job).toMatch(/if \(!delivered\) continue;\s*sent \+= 1;\s*const \{ error \} = await db\.from\("coach_nudges"\)\.upsert/);
    expect(job).toContain('.includes("bookings")');
    expect(read("vercel.json")).toContain('"path": "/api/cron/requests-digest"');
  });
  it("counts the four kinds the Requests page lists as waiting, and a failed or cut-off read counts nothing", () => {
    const lib = read("lib/requests-waiting.ts");
    for (const t of ['from("booking_requests")', 'from("bookings")', 'from("schedule_requests")', 'from("client_requests")']) expect(lib).toContain(t);
    expect(lib).toContain("if (results.some((r) => r.failed || r.truncated)) return null;");
  });
});

describe("the app icon", () => {
  it("shows the number, clears at zero, and does nothing where badges are not supported or the count is unknown", () => {
    const setAppBadge = vi.fn(() => Promise.resolve());
    const clearAppBadge = vi.fn(() => Promise.resolve());
    const nav = { setAppBadge, clearAppBadge } as unknown as Navigator;
    applyAppBadge(nav, 3);
    expect(setAppBadge).toHaveBeenCalledWith(3);
    applyAppBadge(nav, 0);
    expect(clearAppBadge).toHaveBeenCalled();
    setAppBadge.mockClear();
    applyAppBadge(nav, null);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(() => applyAppBadge({} as Navigator, 3)).not.toThrow();
  });
  it("the number is the signed-in coach's own: every read is narrowed to them", () => {
    // (Nov 21, PH1: the icon shows Spotlight's count from /api/coach/spot-needs; lib/clutter-c1-phone.test.ts)
    expect(existsSync(join(__dirname, "..", "app/api/requests/waiting-count/route.ts"))).toBe(false);
    expect(read("lib/requests-waiting.ts")).toContain('const narrow = (q: any) => (onlyCoach ? q.eq("coach_id", onlyCoach) : q);');
    expect(read("components/coach/coach-desktop-shell.tsx")).toContain("<AppBadgeSync />");
    expect(read("components/coach/mobile/coach-mobile-shell.tsx")).toContain("<AppBadgeSync />");
  });
});
