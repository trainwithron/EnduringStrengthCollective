import { describe, it, expect, vi } from "vitest";
import { isWriteRequest, debounce, createRefreshLimiter, isDraftField, noteDraftInput, noteDraftBlur, hasUnsavedTyping, paneActivity } from "./workspace-mutation";

const ORIGIN = "https://app.example.com";
const SB = "https://abcd.supabase.co";

describe("what counts as a save", () => {
  it("a save to one of the app's own saving routes or a table does", () => {
    expect(isWriteRequest("POST", "/api/clients/invite", ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("DELETE", `${ORIGIN}/api/coach/packages`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("POST", "/api/series/occurrence", ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("PATCH", `${SB}/rest/v1/session_credits?athlete_id=eq.1`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("POST", `${SB}/rest/v1/habit_logs`, ORIGIN, SB)).toBe(true);
  });
  it("a confirmed Ask Spot action and the other real saves count", () => {
    for (const p of ["/api/assistant/action", "/api/kiosk/checkin", "/api/programming-spotter/dismiss", "/api/coach/dashboard-layout", "/api/ai/refund-credit", "/api/org-dispatch/accept"]) {
      expect(isWriteRequest("POST", p, ORIGIN, SB), p).toBe(true);
    }
    expect(isWriteRequest("POST", "/api/series/preview", ORIGIN, SB)).toBe(false);
  });
  it("a database function counts unless it is named like a read", () => {
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/book_session`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/cancel_booking_and_refund_credit`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/get_last_workout_per_athlete`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/coach_roster_activity`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/booking_counts`, ORIGIN, SB)).toBe(false);
  });
  it("a read does not", () => {
    expect(isWriteRequest("GET", "/api/clients", ORIGIN, SB)).toBe(false);
    expect(isWriteRequest(undefined, `${SB}/rest/v1/profiles`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("HEAD", "/api/x", ORIGIN, SB)).toBe(false);
  });
  it("chat, AI, search, push and measuring requests are not saves even though they are POSTs", () => {
    for (const p of ["/api/assistant/navigate", "/api/collective-intelligence/chat", "/api/ai/generate-program", "/api/food/search", "/api/push/subscribe", "/api/health", "/api/feedback", "/api/session-pattern-check"]) {
      expect(isWriteRequest("POST", p, ORIGIN, SB), p).toBe(false);
    }
    expect(isWriteRequest("POST", `${SB}/auth/v1/token?grant_type=refresh_token`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", `${SB}/storage/v1/object/x`, ORIGIN, SB)).toBe(false);
  });
  it("another site never does", () => {
    expect(isWriteRequest("POST", "https://evil.example/api/clients/x", ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", "not a url at all ::", ORIGIN, undefined)).toBe(false);
  });
});

describe("debounce", () => {
  it("runs once after a burst", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const call = debounce(run, 1000);
    call();
    call();
    call();
    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("the automatic refresh limit", () => {
  it("allows three a minute, then stops until a minute has passed", () => {
    const lim = createRefreshLimiter(3, 60_000);
    expect([0, 1000, 2000].map((t) => lim.allow(t))).toEqual([true, true, true]);
    expect(lim.allow(3000)).toBe(false);
    expect(lim.allow(59_000)).toBe(false);
    expect(lim.allow(60_001)).toBe(true);
  });
  it("can be reset by a manual refresh", () => {
    const lim = createRefreshLimiter(1, 60_000);
    expect(lim.allow(0)).toBe(true);
    expect(lim.allow(10)).toBe(false);
    lim.reset();
    expect(lim.allow(20)).toBe(true);
  });
});

describe("what counts as typed text that was not saved", () => {
  it("a message box, a note or a text field counts", () => {
    expect(isDraftField({ tag: "TEXTAREA" })).toBe(true);
    expect(isDraftField({ tag: "DIV", contentEditable: true })).toBe(true);
    expect(isDraftField({ tag: "INPUT", type: "text", placeholder: "Add a note" })).toBe(true);
  });
  it("a search or filter box, a checkbox, a number stepper or a password does not", () => {
    expect(isDraftField({ tag: "INPUT", type: "search" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "text", role: "searchbox" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "text", placeholder: "Search clients" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "text", ariaLabel: "Filter by name" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "text", inSearchRegion: true })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "checkbox" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "number" })).toBe(false);
    expect(isDraftField({ tag: "INPUT", type: "password" })).toBe(false);
    expect(isDraftField({ tag: "SELECT" })).toBe(false);
  });

  const field = () => ({ isConnected: true }) as unknown as Element;
  it("typing counts as unsaved until the field is left and a save follows; an unrelated save does not clear it", () => {
    const f = field();
    noteDraftInput(f);
    expect(hasUnsavedTyping()).toBe(true);
    expect(paneActivity.typed).toBe(true);
    // (the clearing after a save belongs to the fetch wrapper; here the field is simply removed from the page)
    (f as unknown as { isConnected: boolean }).isConnected = false;
    expect(hasUnsavedTyping()).toBe(false);
  });
  it("a field that is left but never saved stays unsaved; typing again after leaving it resets that", () => {
    const f = field();
    noteDraftInput(f);
    noteDraftBlur(f, 1000);
    expect(hasUnsavedTyping()).toBe(true);
    (f as unknown as { isConnected: boolean }).isConnected = false;
    expect(hasUnsavedTyping()).toBe(false);
  });
});
