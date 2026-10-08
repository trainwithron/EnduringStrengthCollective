import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the database: group_memberships rows, looked up by group and person.
type Row = { role: string; profile_id?: string; profiles?: { full_name: string } };
let signedIn: { id: string } | null = null;
let rows: Record<string, Row> = {};
let acting = false;
let loaded: unknown = null;
const loadSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn } }) },
    from: () => {
      const filters: Record<string, string> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: string) => ((filters[c] = v), chain),
        maybeSingle: async () => ({ data: rows[`${filters.group_id}:${filters.profile_id}`] ?? null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/acting-as", () => ({ getEffectiveAthlete: async (_g: string, uid: string) => ({ athleteId: uid, realUserId: uid, isActingAsOther: acting }) }));
vi.mock("@/lib/timezone", () => ({ getGroupCoachTimezone: async () => "America/Los_Angeles", dateKeyInZone: () => "2026-10-08" }));
vi.mock("@/lib/nutrient-detail-facts", () => ({
  loadNutrientDetailFacts: async (...args: unknown[]) => {
    loadSpy(...args);
    return loaded;
  },
}));

import { GET } from "@/app/api/nutrients/detail/route";

const call = (qs: string) => GET(new Request(`http://localhost/api/nutrients/detail?${qs}`));

beforeEach(() => {
  signedIn = { id: "client" };
  rows = { "g1:client": { role: "athlete" } };
  acting = false;
  loaded = { detail: { nutrient: { key: "iron_mg" } } };
  loadSpy.mockClear();
});

describe("GET /api/nutrients/detail", () => {
  it("refuses a visitor who is not signed in", async () => {
    signedIn = null;
    expect((await call("groupId=g1&key=iron_mg")).status).toBe(401);
    expect(loadSpy).not.toHaveBeenCalled();
  });
  it("refuses a missing group or a key that is not a plain nutrient name", async () => {
    expect((await call("key=iron_mg")).status).toBe(400);
    expect((await call("groupId=g1&key=iron_mg;drop")).status).toBe(400);
    expect((await call("groupId=g1&key=")).status).toBe(400);
  });
  it("tells someone who is not in the group nothing", async () => {
    signedIn = { id: "stranger" };
    expect((await call("groupId=g1&key=iron_mg")).status).toBe(404);
    expect(loadSpy).not.toHaveBeenCalled();
  });
  it("a client gets their OWN figures, whatever athleteId they send", async () => {
    const res = await call("groupId=g1&key=iron_mg&athleteId=someone-else");
    expect(res.status).toBe(200);
    expect(loadSpy.mock.calls[0][1]).toMatchObject({ athleteId: "client", audience: "client", key: "iron_mg", todayKey: "2026-10-08" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("a coach must name a client, who must be an athlete of this group", async () => {
    signedIn = { id: "coach" };
    rows = { "g1:coach": { role: "coach" }, "g1:a1": { role: "athlete", profile_id: "a1", profiles: { full_name: "Sam Rivera" } } };
    expect((await call("groupId=g1&key=iron_mg")).status).toBe(400);
    expect((await call("groupId=g1&key=iron_mg&athleteId=nobody")).status).toBe(404);
    const ok = await call("groupId=g1&key=iron_mg&athleteId=a1");
    expect(ok.status).toBe(200);
    expect(loadSpy.mock.calls[0][1]).toMatchObject({ athleteId: "a1", audience: "coach", clientName: "Sam Rivera" });
  });
  it("a coach acting as a client is treated as that client", async () => {
    signedIn = { id: "coach" };
    rows = { "g1:coach": { role: "coach" } };
    acting = true;
    const res = await call("groupId=g1&key=iron_mg");
    expect(res.status).toBe(200);
    expect(loadSpy.mock.calls[0][1]).toMatchObject({ audience: "client" });
  });
  it("answers 404 for a nutrient that does not exist", async () => {
    loaded = null;
    expect((await call("groupId=g1&key=nope_mg")).status).toBe(404);
  });
});
