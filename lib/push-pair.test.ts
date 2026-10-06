import { describe, expect, it } from "vitest";
import { clampPush, mayPushTo } from "@/lib/push-pair";

// A stand-in database: tables of rows, filtered by every .eq() in the chain.
function fakeDb(tables: Record<string, Record<string, string>[]>) {
  return {
    from: (table: string) => ({
      select: () => {
        const filters: [string, string][] = [];
        const builder: any = {
          eq: (col: string, value: string) => {
            filters.push([col, value]);
            return builder;
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)) }),
        };
        return builder;
      },
    }),
  };
}

describe("mayPushTo", () => {
  const db = fakeDb({
    group_memberships: [
      { profile_id: "coach", group_id: "g1", role: "coach" },
      { profile_id: "client", group_id: "g1", role: "athlete" },
      { profile_id: "teammate", group_id: "g1", role: "athlete" },
      { profile_id: "other-client", group_id: "g2", role: "athlete" },
      { profile_id: "stranger", group_id: "g9", role: "athlete" },
    ],
    organization_memberships: [
      { profile_id: "coach", organization_id: "o1", role: "coach" },
      { profile_id: "owner", organization_id: "o1", role: "owner" },
      { profile_id: "coach2", organization_id: "o1", role: "coach" },
    ],
    training_partner_requests: [{ id: "r1", from_athlete_id: "client", to_athlete_id: "other-client", status: "accepted" }],
  });
  it("lets a client reach their coach, and a coach their client", async () => {
    expect(await mayPushTo(db, "client", "coach")).toBe(true);
    expect(await mayPushTo(db, "coach", "client")).toBe(true);
  });
  it("lets a person reach themselves", async () => {
    expect(await mayPushTo(db, "client", "client")).toBe(true);
  });
  it("does not let one teammate push another (neither is the coach)", async () => {
    expect(await mayPushTo(db, "client", "teammate")).toBe(false);
  });
  it("lets a coach and the organization owner reach each other, but not two ordinary coaches", async () => {
    expect(await mayPushTo(db, "coach", "owner")).toBe(true);
    expect(await mayPushTo(db, "owner", "coach")).toBe(true);
    expect(await mayPushTo(db, "coach", "coach2")).toBe(false);
  });
  it("lets accepted training partners reach each other, in both directions", async () => {
    expect(await mayPushTo(db, "client", "other-client")).toBe(true);
    expect(await mayPushTo(db, "other-client", "client")).toBe(true);
  });
  it("refuses someone they share nothing with", async () => {
    expect(await mayPushTo(db, "stranger", "coach")).toBe(false);
    expect(await mayPushTo(db, "stranger", "client")).toBe(false);
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
