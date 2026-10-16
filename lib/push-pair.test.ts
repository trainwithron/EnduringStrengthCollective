import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clampPush, mayPushTo, pushPairKey } from "@/lib/push-pair";

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
  it("no longer lets an organization owner or admin push free text to a coach (or the reverse), or two ordinary coaches", async () => {
    expect(await mayPushTo(db, "coach", "owner")).toBe(false);
    expect(await mayPushTo(db, "owner", "coach")).toBe(false);
    expect(await mayPushTo(db, "coach", "coach2")).toBe(false);
  });
  it("no longer lets accepted training partners push each other free text (their requests are server notices)", async () => {
    expect(await mayPushTo(db, "client", "other-client")).toBe(false);
    expect(await mayPushTo(db, "other-client", "client")).toBe(false);
  });
  it("the route limits pushes to one person to ten an hour and only opens in-app paths", () => {
    const route = readFileSync(join(__dirname, "..", "app/api/push/send/route.ts"), "utf8");
    // keyed by sender AND recipient, so ten clients writing to one coach each get their own ten
    expect(route).toContain('rateLimitResponse("push-to", pushPairKey(user.id, profileId), 10, 3600)');
    expect(pushPairKey("clientA", "coach")).not.toBe(pushPairKey("clientB", "coach"));
    expect(pushPairKey("clientA", "coach")).not.toBe(pushPairKey("clientA", "other"));
    expect(pushPairKey("clientA", "coach")).toBe(pushPairKey("clientA", "coach"));
    expect(route).toContain("safePushPath(payload.url)");
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
