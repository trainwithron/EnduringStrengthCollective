import { describe, it, expect, vi } from "vitest";
import { isWriteRequest, debounce } from "./workspace-mutation";

const ORIGIN = "https://app.example.com";
const SB = "https://abcd.supabase.co";

describe("what counts as a save", () => {
  it("a write to the app's own API or the database does", () => {
    expect(isWriteRequest("POST", "/api/clients/invite", ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("PATCH", `${SB}/rest/v1/session_credits?athlete_id=eq.1`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("DELETE", `${ORIGIN}/api/coach/packages`, ORIGIN, SB)).toBe(true);
    expect(isWriteRequest("POST", `${SB}/rest/v1/rpc/book_session`, ORIGIN, SB)).toBe(true);
  });
  it("a read does not", () => {
    expect(isWriteRequest("GET", "/api/clients", ORIGIN, SB)).toBe(false);
    expect(isWriteRequest(undefined, `${SB}/rest/v1/profiles`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("HEAD", "/api/x", ORIGIN, SB)).toBe(false);
  });
  it("measuring and sign-in plumbing do not", () => {
    expect(isWriteRequest("POST", "/api/health", ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", "/api/push/subscribe", ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", `${SB}/auth/v1/token?grant_type=refresh_token`, ORIGIN, SB)).toBe(false);
    expect(isWriteRequest("POST", `${SB}/storage/v1/object/x`, ORIGIN, SB)).toBe(false);
  });
  it("another site never does", () => {
    expect(isWriteRequest("POST", "https://evil.example/api/x", ORIGIN, SB)).toBe(false);
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
