import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs the signup route with fakes that behave like the real database where it matters: a legal acceptance can only be recorded for a profile that
// already exists (the foreign key from migration 0255). Before the fix the route recorded it first, so it was never recorded.
const state = vi.hoisted(() => ({ orgArgs: [] as { starterGroupName?: string }[], calls: [] as string[], profiles: new Set<string>(), recorded: [] as string[], failLegal: false }));

vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: async () => null, rateLimitAllows: async () => true, clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/app-url", () => ({ appOrigin: () => "https://app.test" }));
vi.mock("@/lib/org-creation", () => ({ createOrganization: async (_c: unknown, args: { starterGroupName?: string }) => { state.orgArgs.push(args); return { groupId: "g1" }; } }));
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
      update: (row: { coach_type?: string }) => ({
        eq: async () => {
          state.calls.push(`update:${table}:${row.coach_type}`);
          return { error: null };
        },
      }),
      upsert: async (row: { booking_mode?: string }) => {
        state.calls.push(`upsert:${table}:${row.booking_mode}`);
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

const post = async (extra: Record<string, unknown> = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const { POST } = await import("./route");
  return POST(new Request("https://app.test/api/coaches/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Casey Coach", orgName: "Casey Fitness", email: "casey@example.com", password: "longenough1", acceptedLegal: true, ...extra }),
  }));
};

beforeEach(() => { state.orgArgs = []; state.calls = []; state.profiles.clear(); state.recorded = []; state.failLegal = false; });

describe("coach signup records what they agreed to", () => {
  it("creates the account, then the profile, then the acceptance, in that order, and the acceptance is actually recorded", async () => {
    const res = await post();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(state.calls.slice(0, 3)).toEqual(["createUser", "insert:profiles", "recordLegal"]);
    expect(state.recorded).toEqual(["u1"]);
    expect(json.legalRecorded).toBe(true);
  });
  it("a brand-new coach starts in request booking (clients ask, the coach approves)", async () => {
    await post();
    expect(state.calls).toContain("upsert:coach_booking_policies:request");
  });
  it("saves what they coach on its own after the organization exists, and a team coach's first group is called My Team", async () => {
    await post({ coachType: "team" });
    expect(state.calls).toContain("update:profiles:team");
    expect(state.orgArgs[0].starterGroupName).toBe("My Team");
  });
  it("ignores a coach type it does not know and keeps the usual first group", async () => {
    await post({ coachType: "astronaut" });
    expect(state.calls.some((c) => c.startsWith("update:profiles"))).toBe(false);
    expect(state.orgArgs[0].starterGroupName).toBe("Main Group");
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
