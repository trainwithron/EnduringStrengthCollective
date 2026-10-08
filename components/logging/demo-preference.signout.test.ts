import { describe, it, expect, vi, beforeEach } from "vitest";

let authCallback: ((event: string) => void) | null = null;
let user: { id: string } | null = { id: "u1" };
let row: { hide_demos: boolean } | null = { hide_demos: true };
let selects = 0;
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({ data: { user } }),
      onAuthStateChange: (cb: (event: string) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            selects += 1;
            return { data: row, error: null };
          },
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

const store = new Map<string, string>();
const listeners = new Map<string, (() => void)[]>();
beforeEach(() => {
  store.clear();
  listeners.clear();
  selects = 0;
  authCallback = null;
  user = { id: "u1" };
  row = { hide_demos: true };
  vi.resetModules();
  (globalThis as any).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    dispatchEvent: (e: { type: string }) => (listeners.get(e.type) ?? []).forEach((f) => f()),
    addEventListener: (t: string, f: () => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
    removeEventListener: () => undefined,
  };
  (globalThis as any).Event = class {
    constructor(public type: string) {}
  };
});

// The hook needs React; the account load it triggers is what is tested, through a minimal stand-in for React's hooks.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState: (v: unknown) => [v, () => undefined], useEffect: (fn: () => void) => void fn() };
});

describe("signing out and in on a shared device", () => {
  it("signing out clears the device copy and the cached answer; signing in as someone else loads their choice", async () => {
    const { useDemosHidden, readDemosHidden } = await import("./demo-preference");
    useDemosHidden();
    await new Promise((r) => setTimeout(r, 0));
    expect(readDemosHidden()).toBe(true);
    expect(selects).toBe(1);
    expect(authCallback).toBeTruthy();

    authCallback!("SIGNED_OUT");
    expect(readDemosHidden()).toBe(false);

    // a different person signs in; their row says demos are shown
    user = { id: "u2" };
    row = { hide_demos: false };
    authCallback!("SIGNED_IN");
    await new Promise((r) => setTimeout(r, 0));
    expect(selects).toBe(2);
    expect(readDemosHidden()).toBe(false);
  });
  it("the first person's choice is not carried to the next person when the second has no row yet", async () => {
    const { useDemosHidden, readDemosHidden } = await import("./demo-preference");
    useDemosHidden();
    await new Promise((r) => setTimeout(r, 0));
    expect(readDemosHidden()).toBe(true);
    authCallback!("SIGNED_OUT");
    user = { id: "u3" };
    row = null;
    authCallback!("SIGNED_IN");
    await new Promise((r) => setTimeout(r, 0));
    expect(readDemosHidden()).toBe(false);
  });
});
