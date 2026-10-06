import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs the signup route with fakes that behave like the real database where it matters: a legal acceptance can only be recorded for a profile that
// already exists (the foreign key from migration 0255). Before the fix the route recorded it first, so it was never recorded.
const state = vi.hoisted(() => ({ calls: [] as string[], profiles: new Set<string>(), recorded: [] as string[], failLegal: false }));

vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null, clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/app-url", () => ({ appOrigin: () => "https://app.test" }));
vi.mock("@/lib/org-creation", () => ({ createOrganization: async () => ({ groupId: "g1" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { resend: async () => ({ error: null }) } }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: { admin: { createUser: async () => { state.calls.push("createUser"); return { data: { user: { id: "u1" } }, error: null }; } } },
    from: (table: string) => ({
      insert: async (row: { id: string }) => {
        state.calls.push(`insert:${table}`);
        if (table === "profiles") state.profiles.add(row.id);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/legal-record", () => ({
  recordLegalAcceptances: async (_c: unknown, args: { profileId: string }) => {
    state.calls.push("recordLegal");
    if (state.failLegal) throw new Error("boom");
    if (!state.profiles.has(args.profileId)) return false; // the foreign key
    state.recorded.push(args.profileId);
    return true;
  },
}));

const post = async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const { POST } = await import("./route");
  return POST(new Request("https://app.test/api/coaches/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Casey Coach", orgName: "Casey Fitness", email: "casey@example.com", password: "longenough1", acceptedLegal: true }),
  }));
};

beforeEach(() => { state.calls = []; state.profiles.clear(); state.recorded = []; state.failLegal = false; });

describe("coach signup records what they agreed to", () => {
  it("creates the account, then the profile, then the acceptance, in that order, and the acceptance is actually recorded", async () => {
    const res = await post();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(state.calls.slice(0, 3)).toEqual(["createUser", "insert:profiles", "recordLegal"]);
    expect(state.recorded).toEqual(["u1"]);
    expect(json.legalRecorded).toBe(true);
  });
  it("still signs them up when recording fails, but says so in the response and in the log", async () => {
    state.failLegal = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.legalRecorded).toBe(false);
    expect(spy.mock.calls.flat().join(" ")).toMatch(/NOT recorded|threw/);
    spy.mockRestore();
  });
});
