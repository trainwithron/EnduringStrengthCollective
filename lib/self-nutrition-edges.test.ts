import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOwnPersonalSpace, ownPersonalSpaceIds } from "./own-personal-space";

// Ron, Nov 21: "I want to be able to assign meal plans to myself." A coach's own nutrition lives in their personal space (their group with no organization); the three places that act
// for "the athlete" now allow that one case and nothing else. The database side is rehearsed in scripts/sql-tests/self-nutrition-edges.test.mjs (step 221).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// groups: id, created_by, organization_id
const GROUPS = [
  { id: "space-ron", created_by: "ron", organization_id: null },
  { id: "org-group", created_by: "ron", organization_id: "org1" },
  { id: "space-other", created_by: "other", organization_id: null },
];
function fakeDb(fail = false) {
  const q = (filters: Record<string, unknown>, nullCols: string[]) => {
    const rows = () => GROUPS.filter((g) => Object.entries(filters).every(([k, v]) => (g as any)[k] === v) && nullCols.every((c) => (g as any)[c] === null));
    const api: any = {
      eq: (k: string, v: unknown) => q({ ...filters, [k]: v }, nullCols),
      is: (k: string) => q(filters, [...nullCols, k]),
      maybeSingle: async () => (fail ? { data: null, error: { message: "down" } } : { data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => res(fail ? { data: null, error: { message: "down" } } : { data: rows(), error: null }),
    };
    return api;
  };
  return { from: () => ({ select: () => q({}, []) }) } as any;
}

describe("the person's own personal space", () => {
  it("is their own group with no organization: never an organization's group, never someone else's", async () => {
    expect(await isOwnPersonalSpace(fakeDb(), "ron", "space-ron")).toBe(true);
    expect(await isOwnPersonalSpace(fakeDb(), "ron", "org-group")).toBe(false);
    expect(await isOwnPersonalSpace(fakeDb(), "other", "space-ron")).toBe(false);
    expect(await isOwnPersonalSpace(fakeDb(), "ron", "space-other")).toBe(false);
    expect(await isOwnPersonalSpace(fakeDb(true), "ron", "space-ron")).toBe(false);
    expect(await ownPersonalSpaceIds(fakeDb(), "ron")).toEqual(["space-ron"]);
    expect(await ownPersonalSpaceIds(fakeDb(true), "ron")).toEqual([]);
  });
});

describe("(b) importing nutrition history onto the coach's own row", () => {
  it("allows only the coach themselves in their own personal space; any other non-client is still refused", () => {
    const route = read("app/api/clients/nutrition-history/route.ts");
    // the caller must still coach the group
    expect(route).toContain('if (caller?.role !== "coach") return');
    expect(route).toContain('const ownSpace = member?.role !== "athlete" && athleteId === user.id && (await isOwnPersonalSpace(serviceRole, user.id, groupId));');
    expect(route).toContain('if (member?.role !== "athlete" && !ownSpace) return');
  });
});

describe("(c) a different plan and the allergy rebuild for the coach's own plan", () => {
  it("plan-retry: an athlete of the group, or a coach in their OWN personal space; a coach on anyone else's plan is still refused", () => {
    const route = read("app/api/nutrition/plan-retry/route.ts");
    expect(route).toContain('const ownSpace = membership?.role === "coach" && (await isOwnPersonalSpace(createServiceRoleClient(), user.id, groupId));');
    expect(route).toContain('if (!membership || (membership.role !== "athlete" && !ownSpace)) return fail("Only the client can ask for a different plan.", 403);');
    // it only ever acts on the signed-in person's own plan
    expect(route).toContain("p_athlete_id: user.id,");
  });
  it("allergy-rebuild: the groups where they are the athlete, plus their own personal space", () => {
    const route = read("app/api/nutrition/allergy-rebuild/route.ts");
    expect(route).toContain("...(await ownPersonalSpaceIds(service, user.id))");
    expect(route).toContain("p_athlete_id: user.id,");
  });
  it("the database step lets the same one case through, and tells nobody about their own request", () => {
    const sql = read("supabase/migrations/0465_self_nutrition_edges.sql");
    expect(sql).toContain("g.created_by = p_athlete_id and g.organization_id is null");
    expect(sql).toContain("and profile_id <> p_athlete_id loop");
    expect(sql).toContain("client_nutrition_flags.profile_id = (select auth.uid())");
  });
});
