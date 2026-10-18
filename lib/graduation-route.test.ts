import { describe, it, expect, vi, beforeEach } from "vitest";

// The route run against a stand-in database: who is emailed depends only on the records (the year stored on the retired season, the class years, the next roster, whether the address is proven), never on the request.
const state = vi.hoisted(() => ({
  group: { name: "Varsity", group_kind: "team", archived_at: "2026-06-01T12:00:00Z", next_season_id: "next", graduates_through: 2026 as number | null },
  players: [] as { profile_id: string; graduation_year: number; full_name: string }[],
  staying: [] as string[],
  exportsRows: [] as { athlete_id: string; claimed_at: string; sent_at: string | null }[],
  users: {} as Record<string, { email: string; last_sign_in_at: string | null }>,
  mails: [] as string[],
  claims: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "coach" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "coach" } }) }) }) }) }),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: async (to: string) => (state.mails.push(to), true) }));
vi.mock("@/lib/graduation-server", () => ({ loadTrainingHistory: async () => ({ sessions: [], failed: false, truncated: false }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: state.users[id] ?? null } }) } },
    from: (table: string) => {
      const q: any = {
        _op: "select",
        select() { return q; },
        eq() { return q; }, not() { return q; }, is() { return q; }, order() { return q; },
        insert(row: { athlete_id: string }) { q._op = "insert"; q._row = row; return q; },
        update() { q._op = "update"; return q; },
        delete() { q._op = "delete"; return q; },
        range: async () => ({ data: q._rows(), error: null }),
        maybeSingle: async () => ({ data: table === "groups" ? state.group : null, error: null }),
        then(resolve: (v: unknown) => void) {
          if (q._op === "insert") state.claims.push(q._row.athlete_id);
          resolve({ data: null, error: null });
        },
        _rows() {
          if (table === "group_memberships") return state.players.map((p, i) => ({ id: String(i), profile_id: p.profile_id, graduation_year: p.graduation_year, profiles: { full_name: p.full_name } })).concat(state.staying.map((s, i) => ({ id: "s" + i, profile_id: s, graduation_year: 0, profiles: { full_name: "" } })).filter(() => false));
          if (table === "graduation_exports") return state.exportsRows;
          return [];
        },
      };
      // the next season's roster is read from group_memberships too: tell the two apart by the group id asked for
      if (table === "group_memberships") {
        const eqs: string[] = [];
        const origEq = q.eq;
        q.eq = (col: string, val: string) => (col === "group_id" && eqs.push(val), origEq());
        const origRange = q.range;
        q.range = async () => (eqs.includes("next") ? { data: state.staying.map((s, i) => ({ id: "n" + i, profile_id: s })), error: null } : origRange());
      }
      return q;
    },
  }),
}));

import { POST } from "@/app/api/season/graduate/route";

const call = (body: unknown) => POST(new Request("http://x/api/season/graduate", { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
const signedIn = { email: "", last_sign_in_at: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  state.group = { name: "Varsity", group_kind: "team", archived_at: "2026-06-01T12:00:00Z", next_season_id: "next", graduates_through: 2026 };
  state.players = [
    { profile_id: "a", graduation_year: 2026, full_name: "Ann A" },
    { profile_id: "b", graduation_year: 2027, full_name: "Bo B" },
  ];
  state.staying = [];
  state.exportsRows = [];
  state.users = { a: { ...signedIn, email: "a@example.com" }, b: { ...signedIn, email: "b@example.com" } };
  state.mails = [];
  state.claims = [];
});

describe("who the graduation route emails", () => {
  it("uses the year stored on the retired season; a year in the request is ignored", async () => {
    const r = await call({ groupId: "g", year: 2027, graduatesThrough: 2027 });
    expect(state.mails).toEqual(["a@example.com"]);
    expect(r.sent).toBe(1);
  });

  it("a stored year beats the year it was retired in", async () => {
    state.group.graduates_through = 2027;
    await call({ groupId: "g" });
    expect(state.mails.sort()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("a season retired before the stored year existed falls back to the year it was retired in", async () => {
    state.group.graduates_through = null;
    state.group.archived_at = "2026-06-01T12:00:00Z";
    await call({ groupId: "g", year: 2099 });
    expect(state.mails).toEqual(["a@example.com"]);
  });

  it("a player who stays for next season is not emailed", async () => {
    state.staying = ["a"];
    const r = await call({ groupId: "g" });
    expect(state.mails).toEqual([]);
    expect(r.sent).toBe(0);
  });

  it("an address the player never signed in with is not trusted: the player is listed, nothing is sent", async () => {
    state.users.a = { email: "jon@gmial.com", last_sign_in_at: null };
    const r = await call({ groupId: "g" });
    expect(state.mails).toEqual([]);
    expect(r.problems).toEqual([{ name: "Ann A", why: expect.stringContaining("no email address we can be sure is theirs") }]);
  });

  it("a player already sent to, or with a claim of doubtful age, is left alone and a doubtful one is offered to the coach", async () => {
    state.exportsRows = [{ athlete_id: "a", claimed_at: "2026-06-02T00:00:00Z", sent_at: null }];
    const r = await call({ groupId: "g" });
    expect(state.mails).toEqual([]);
    expect(r.uncertain).toEqual([{ id: "a", name: "Ann A" }]);
  });
});
