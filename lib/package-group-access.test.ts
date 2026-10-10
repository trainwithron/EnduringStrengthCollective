import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grantLinkedGroupAccess, groupBelongsToCoach, revokeLinkedGroupAccess } from "./package-group-access";

type Row = Record<string, unknown>;

// A small in-memory stand-in for the database: tables of rows, eq filters, select / insert / upsert / delete, maybeSingle and limit.
function fakeDb(initial: Record<string, Row[]>, opts: { failInsertOn?: string } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));
  const from = (table: string) => {
    tables[table] ??= [];
    let mode: "select" | "delete" | "update" = "select";
    let patch: Row = {};
    const filters: [string, unknown][] = [];
    let max = Infinity;
    const matching = () => tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
    const result = () => {
      if (mode === "update") {
        for (const r of matching()) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (mode === "delete") {
        const gone = new Set(matching());
        tables[table] = tables[table].filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return { data: matching().slice(0, max), error: null };
    };
    const q: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result());
          if (prop === "select") return () => q;
          if (prop === "delete") return () => ((mode = "delete"), q);
          if (prop === "update") return (p: Row) => ((mode = "update"), (patch = p), q);
          if (prop === "eq") return (c: string, v: unknown) => (filters.push([c, v]), q);
          if (prop === "limit") return (n: number) => ((max = n), q);
          if (prop === "maybeSingle") return async () => ({ data: matching()[0] ?? null, error: null });
          if (prop === "insert") {
            return async (row: Row) => {
              if (opts.failInsertOn === table) return { error: { message: "denied" } };
              tables[table].push({ ...row });
              return { error: null };
            };
          }
          if (prop === "upsert") {
            return async (row: Row, o: { onConflict?: string }) => {
              const keys = (o?.onConflict ?? "").split(",").filter(Boolean);
              if (!tables[table].some((r) => keys.length > 0 && keys.every((k) => r[k] === row[k]))) tables[table].push({ ...row });
              return { error: null };
            };
          }
          return undefined;
        },
      }
    );
    return q;
  };
  return { db: { from } as any, tables };
}

const base = (extra: Record<string, Row[]> = {}) => ({
  coach_packages: [{ id: "pkg1", coach_id: "coach", group_access_group_id: "gA" }],
  group_memberships: [{ group_id: "gA", profile_id: "coach", role: "coach" }],
  package_group_access: [],
  ...extra,
});

describe("a package that opens a group", () => {
  it("checks the group is one the coach coaches", async () => {
    const { db } = fakeDb(base());
    expect(await groupBelongsToCoach(db, "coach", "gA")).toBe(true);
    expect(await groupBelongsToCoach(db, "coach", "gOther")).toBe(false);
    expect(await groupBelongsToCoach(db, "someone", "gA")).toBe(false);
  });

  it("never a client's one-on-one space", async () => {
    const { db } = fakeDb(base({ groups: [{ id: "gA", group_kind: "one_on_one" }] }));
    expect(await groupBelongsToCoach(db, "coach", "gA")).toBe(false);
    const team = fakeDb(base({ groups: [{ id: "gA", group_kind: "team" }] }));
    expect(await groupBelongsToCoach(team.db, "coach", "gA")).toBe(true);
  });

  it("makes the buyer a member and records that the package did it", async () => {
    const { db, tables } = fakeDb(base());
    const r = await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    expect(r).toEqual({ granted: true });
    expect(tables.group_memberships).toContainEqual({ group_id: "gA", profile_id: "ann", role: "athlete" });
    expect(tables.package_group_access).toEqual([{ athlete_id: "ann", group_id: "gA", coach_package_id: "pkg1", created_membership: true }]);
  });

  it("does nothing for a package with no group, and nothing is added twice", async () => {
    const none = fakeDb({ ...base(), coach_packages: [{ id: "pkg1", coach_id: "coach", group_access_group_id: null }] });
    expect(await grantLinkedGroupAccess(none.db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ granted: false });
    expect(none.tables.group_memberships).toHaveLength(1);
    expect(await grantLinkedGroupAccess(none.db, { coachPackageId: null, athleteId: "ann" })).toEqual({ granted: false });

    const { db, tables } = fakeDb(base());
    await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    expect(tables.group_memberships.filter((m) => m.profile_id === "ann")).toHaveLength(1);
    expect(tables.package_group_access).toHaveLength(1);
  });

  it("refuses a group the package's coach does not coach (checked again at grant time)", async () => {
    const { db, tables } = fakeDb({ ...base(), coach_packages: [{ id: "pkg1", coach_id: "coach", group_access_group_id: "gElsewhere" }] });
    const r = await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    expect(r.granted).toBe(false);
    expect(r.error).toBeTruthy();
    expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(false);
  });

  it("someone already in the group is not added again, and is never removed later", async () => {
    const { db, tables } = fakeDb(base({ group_memberships: [{ group_id: "gA", profile_id: "coach", role: "coach" }, { group_id: "gA", profile_id: "ann", role: "athlete" }] }));
    expect(await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ granted: true });
    expect(tables.package_group_access[0].created_membership).toBe(false);
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ removed: false });
    expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(true);
    expect(tables.package_group_access).toHaveLength(0);
  });

  it("a failed add says so and records nothing", async () => {
    const { db, tables } = fakeDb(base(), { failInsertOn: "group_memberships" });
    const r = await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    expect(r.granted).toBe(false);
    expect(r.error).toBeTruthy();
    expect(tables.package_group_access).toHaveLength(0);
  });
});

describe("a subscription that ends", () => {
  it("takes back the group the package gave, and only that", async () => {
    const { db, tables } = fakeDb(base());
    await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ removed: true });
    expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(false);
    expect(tables.group_memberships.some((m) => m.profile_id === "coach")).toBe(true);
    expect(tables.package_group_access).toHaveLength(0);
  });

  it("keeps the client in the group while another package still gives it", async () => {
    const { db, tables } = fakeDb(base({ coach_packages: [{ id: "pkg1", coach_id: "coach", group_access_group_id: "gA" }, { id: "pkg2", coach_id: "coach", group_access_group_id: "gA" }] }));
    await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
    await grantLinkedGroupAccess(db, { coachPackageId: "pkg2", athleteId: "ann" });
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ removed: false });
    expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(true);
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: "pkg2", athleteId: "ann" })).toEqual({ removed: true });
  });

  it("two packages for the same group: the group is taken back after the LAST one ends, in either order", async () => {
    for (const order of [["pkg1", "pkg2"], ["pkg2", "pkg1"]]) {
      const { db, tables } = fakeDb(base({ coach_packages: [{ id: "pkg1", coach_id: "coach", group_access_group_id: "gA" }, { id: "pkg2", coach_id: "coach", group_access_group_id: "gA" }] }));
      await grantLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" });
      await grantLinkedGroupAccess(db, { coachPackageId: "pkg2", athleteId: "ann" });
      await revokeLinkedGroupAccess(db, { coachPackageId: order[0], athleteId: "ann" });
      expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(true);
      expect(await revokeLinkedGroupAccess(db, { coachPackageId: order[1], athleteId: "ann" })).toEqual({ removed: true });
      expect(tables.group_memberships.some((m) => m.profile_id === "ann")).toBe(false);
      expect(tables.package_group_access).toHaveLength(0);
    }
  });

  it("does nothing for a package that gave no access", async () => {
    const { db } = fakeDb(base());
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: "pkg1", athleteId: "ann" })).toEqual({ removed: false });
    expect(await revokeLinkedGroupAccess(db, { coachPackageId: null, athleteId: "ann" })).toEqual({ removed: false });
  });
});

describe("wiring", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  it("a payment, a new subscription and a paid renewal grant the access, and only a lapsed subscription takes it back", () => {
    const hook = read("app/api/stripe/webhook/route.ts");
    expect(hook.match(/grantGroupAccessLogged\(supabase, coachPackageId, athleteId\)/g)?.length).toBe(3);
    expect(hook).toContain("if (endsGroupAccess(status)) {");
    expect(hook).toContain("revokeLinkedGroupAccess(supabase");
    expect(read("app/api/coach/package-assignments/route.ts")).toContain("grantLinkedGroupAccess(createServiceRoleClient()");
  });
  it("a package can only name a group its coach coaches, on create and on edit", () => {
    const route = read("app/api/coach/packages/route.ts");
    expect(route.match(/groupBelongsToCoach\(serviceRole, authCheck\.userId, groupAccessGroupId\)/g)?.length).toBe(2);
  });
  it("handing a package to a client by hand only brings in someone the coach already coaches, and a payment is never failed by an access problem", () => {
    const route = read("app/api/coach/package-assignments/route.ts");
    expect(route).toContain('supabase.rpc("is_coach_of_athlete", { target_athlete_id: athleteId })');
    expect(route.indexOf("is_coach_of_athlete")).toBeLessThan(route.indexOf("grantLinkedGroupAccess(createServiceRoleClient()"));
    expect(read("app/api/stripe/webhook/route.ts")).toContain("console.error(\"package group access not granted\"");
  });
  it("the picker offers team and social groups, never a client's one-on-one space", () => {
    const page = read("app/(coach)/groups/[groupId]/business/packages/page.tsx");
    expect(page).toContain('g.kind !== "one_on_one"');
  });
});
