import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const upserts: Record<string, unknown>[] = [];
let userId: string | null = "u1";
let upsertError: unknown = null;
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>) => {
        upserts.push({ table, ...row });
        return { error: upsertError };
      },
    }),
  }),
}));

const store = new Map<string, string>();
const events: string[] = [];
beforeEach(() => {
  store.clear();
  events.length = 0;
  upserts.length = 0;
  userId = "u1";
  upsertError = null;
  (globalThis as any).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    dispatchEvent: (e: { type: string }) => events.push(e.type),
  };
  (globalThis as any).Event = class {
    constructor(public type: string) {}
  };
});

describe("hide demos follows the person", () => {
  it("applies at once on this device and saves to the person's account", async () => {
    const { writeDemosHidden, readDemosHidden } = await import("./demo-preference");
    const saved = await writeDemosHidden(true);
    expect(saved).toBe(true);
    expect(readDemosHidden()).toBe(true);
    expect(events).toContain("demos-hidden-changed");
    expect(upserts[0]).toMatchObject({ table: "client_ui_settings", athlete_id: "u1", hide_demos: true });
  });
  it("turning it back on clears the device copy and saves that too", async () => {
    const { writeDemosHidden, readDemosHidden } = await import("./demo-preference");
    await writeDemosHidden(true);
    expect(await writeDemosHidden(false)).toBe(true);
    expect(readDemosHidden()).toBe(false);
    expect(upserts[1]).toMatchObject({ hide_demos: false });
  });
  it("when the account cannot be reached the device copy still applies and the caller is told it did not save", async () => {
    const { writeDemosHidden, readDemosHidden } = await import("./demo-preference");
    upsertError = { message: "offline" };
    expect(await writeDemosHidden(true)).toBe(false);
    expect(readDemosHidden()).toBe(true);
    userId = null;
    upsertError = null;
    expect(await writeDemosHidden(false)).toBe(false);
  });
  it("the settings screen says it follows the person and tells them if it did not save", () => {
    const toggle = readFileSync(join(__dirname, "..", "athlete/hide-demos-toggle.tsx"), "utf8");
    expect(toggle).toContain("follows you to your other devices");
    expect(toggle).toContain("didn't save to your account");
    expect(toggle).not.toContain("this device only");
  });
});
