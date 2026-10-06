import { describe, expect, it } from "vitest";
import { clampPush, mayPushTo } from "@/lib/push-pair";

// A stand-in database: tables of rows filtered by profile_id.
function fakeDb(tables: Record<string, { profile_id: string; [k: string]: string }[]>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: async (_col: string, value: string) => ({ data: (tables[table] ?? []).filter((r) => r.profile_id === value) }),
      }),
    }),
  };
}

describe("mayPushTo", () => {
  const db = fakeDb({
    group_memberships: [
      { profile_id: "coach", group_id: "g1" },
      { profile_id: "client", group_id: "g1" },
      { profile_id: "other-client", group_id: "g2" },
      { profile_id: "stranger", group_id: "g9" },
    ],
    organization_memberships: [
      { profile_id: "coach", organization_id: "o1" },
      { profile_id: "owner", organization_id: "o1" },
    ],
  });
  it("lets a client reach their coach, and a coach their client", async () => {
    expect(await mayPushTo(db, "client", "coach")).toBe(true);
    expect(await mayPushTo(db, "coach", "client")).toBe(true);
  });
  it("lets a person reach themselves", async () => {
    expect(await mayPushTo(db, "client", "client")).toBe(true);
  });
  it("lets a coach reach the organization owner they share an org with", async () => {
    expect(await mayPushTo(db, "coach", "owner")).toBe(true);
  });
  it("refuses someone they share nothing with", async () => {
    expect(await mayPushTo(db, "stranger", "coach")).toBe(false);
    expect(await mayPushTo(db, "client", "other-client")).toBe(false);
  });
});

describe("clampPush", () => {
  it("shortens long text and handles non-strings", () => {
    const r = clampPush("x".repeat(200), "y".repeat(500));
    expect(r.title.length).toBe(80);
    expect(r.body.length).toBe(140);
    expect(clampPush(5, undefined)).toEqual({ title: "", body: "" });
  });
});
