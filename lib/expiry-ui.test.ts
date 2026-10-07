import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Guards for the human credit-expiry work (Ron, Oct 6): prompts before anything expires, a hold for one client, reinstating, and a client who is told
// the window. Nothing here sends or changes anything on its own.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("credit expiry stays human", () => {
  it("the nightly job leaves a client with a hold alone", () => {
    const cron = read("../app/api/cron/expire-session-credits/route.ts");
    expect(cron).toContain("expiry_hold_until");
    expect(cron.indexOf("expiry_hold_until && new Date")).toBeLessThan(cron.indexOf("isCreditBalanceExpired(row.last_granted_at"));
  });
  it("the coach panel offers a drafted message, an extension or pause, Not now and Reinstate, through the database functions", () => {
    const panel = read("../components/coach/expiry-checkin-panel.tsx");
    for (const word of ["Message them", "Extend or pause", "Not now", "Reinstate sessions"]) expect(panel).toContain(word);
    expect(panel).toContain("set_credit_expiry_hold");
    expect(panel).toContain("reinstate_expired_credits");
    expect(panel).toContain("spotter_recommendation_feedback");
    expect(panel).not.toMatch(/auto-?send|sendMessage\(/);
  });
  it("the drafted note only opens in the coach's box and is capped, never sent by itself", () => {
    const page = read("../app/(coach)/groups/[groupId]/messages/[otherId]/page.tsx");
    expect(page).toContain('.slice(0, 600)');
    expect(page).toContain("initialDraft={viewerIsCoach ? initialDraft : \"\"}");
  });
  it("the panel is on the dashboard and the phone Home, and the heads-up days are a coach setting", () => {
    expect(read("../app/(coach)/dashboard/page.tsx")).toContain("<ExpiryCheckInPanel />");
    expect(read("../components/coach/mobile/coach-mobile-home.tsx")).toContain("<ExpiryCheckInPanel />");
    expect(read("../app/(coach)/groups/[groupId]/availability/page.tsx")).toContain("ExpiryHeadsUpControl");
  });
  it("a client is told the window where their balance is shown", () => {
    for (const p of ["../app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "../app/(coach)/groups/[groupId]/programs/[programId]/calendar/[date]/page.tsx"]) {
      expect(read(p)).toContain("expiryWindowLine(creditExpiryDaysForNote)");
    }
  });
  it("the cancellation-policy copy no longer says a late cancel loses the session", () => {
    const src = read("../components/coach/desktop/booking-policy-control.tsx");
    expect(src).not.toContain("loses that session");
    expect(src).toContain("flagged to you");
  });
});
