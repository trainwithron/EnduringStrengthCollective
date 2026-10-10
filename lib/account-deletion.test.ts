import { describe, expect, it } from "vitest";
import { deletionBlocker, eraseAccount } from "@/lib/account-deletion";

const plain = { isPlatformAdmin: false, coachGroupCount: 0, orgMembershipCount: 0, createdGroupCount: 0, liveSubscriptionCount: 0 };

describe("deletionBlocker", () => {
  it("lets a plain client be deleted", () => {
    expect(deletionBlocker(plain)).toBeNull();
  });
  it("refuses admins, coaches, organization members and group creators", () => {
    expect(deletionBlocker({ ...plain, isPlatformAdmin: true })).toMatch(/administrator/);
    expect(deletionBlocker({ ...plain, coachGroupCount: 1 })).toMatch(/coaches or owns/);
    expect(deletionBlocker({ ...plain, orgMembershipCount: 1 })).toMatch(/coaches or owns/);
    expect(deletionBlocker({ ...plain, createdGroupCount: 1 })).toMatch(/coaches or owns/);
  });
  it("refuses while a subscription is live", () => {
    expect(deletionBlocker({ ...plain, liveSubscriptionCount: 1 })).toMatch(/subscription/);
  });
});

// A recording stand-in for the database client: every call is logged in order.
function fakeDb(failAt?: string) {
  const calls: string[] = [];
  const chain = (table: string, op: string) => ({
    eq: async (col: string, value: string) => {
      calls.push(`${op} ${table}.${col}`);
      if (table === "groups") calls.push(`group ${value}`);
      return { error: failAt === `${op} ${table}` ? { message: "boom" } : null };
    },
  });
  const db: any = {
    from: (table: string) => ({
      delete: () => chain(table, "delete"),
      update: (patch: object) => chain(table, Object.keys(patch)[0] === "athlete_id" ? "update" : "update-author"),
    }),
    rpc: async (name: string, args: { p_user: string }) => {
      calls.push(`rpc ${name} ${args.p_user}`);
      return { error: failAt === "rpc" ? { message: "cannot_delete: shared" } : null };
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          calls.push(`deleteUser ${id}`);
          return { error: failAt === "deleteUser" ? { message: "nope" } : null };
        },
      },
    },
  };
  return { db, calls };
}

describe("eraseAccount", () => {
  it("keeps history by detaching it, keeps billing, then deletes the account last", async () => {
    const { db, calls } = fakeDb();
    const r = await eraseAccount(db, "u1", { eraseHistory: false });
    expect(r.ok).toBe(true);
    expect(calls).toContain("update workout_logs.athlete_id");
    expect(calls).toContain("update credit_purchases.athlete_id");
    expect(calls.some((c) => c.startsWith("delete workout_logs"))).toBe(false);
    expect(calls[calls.length - 1]).toBe("deleteUser u1");
  });
  it("erases workouts and notes too when asked, but still only detaches billing", async () => {
    const { db, calls } = fakeDb();
    await eraseAccount(db, "u1", { eraseHistory: true });
    expect(calls).toContain("delete workout_logs.athlete_id");
    expect(calls).toContain("delete athlete_notes.athlete_id");
    expect(calls).toContain("update credit_purchases.athlete_id");
    expect(calls.some((c) => c.startsWith("delete credit_purchases"))).toBe(false);
  });
  it("clears rows the person authored before deleting the account, so a not-null column cannot block it", async () => {
    const { db, calls } = fakeDb();
    await eraseAccount(db, "u1", { eraseHistory: false });
    expect(calls.indexOf("delete client_goals.created_by")).toBeGreaterThan(-1);
    expect(calls.indexOf("delete client_goals.created_by")).toBeLessThan(calls.indexOf("deleteUser u1"));
    expect(calls).toContain("update-author minor_consent.verified_by");
  });
  it("stops at the first failure and never deletes the account after one", async () => {
    const { db, calls } = fakeDb("update credit_purchases");
    const r = await eraseAccount(db, "u1", { eraseHistory: false });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("deleteUser"))).toBe(false);
  });
  it("keeps the emptied one-on-one space (renamed) when history is kept, so the kept records are not deleted with it", async () => {
    const { db, calls } = fakeDb();
    await eraseAccount(db, "u1", { eraseHistory: false, deleteEmptyOneOnOneGroups: ["g9"] });
    expect(calls).not.toContain("delete groups.id");
    expect(calls).toContain("update-author groups.id");
  });
  it("removes the emptied space only when history is erased too, after the account is gone", async () => {
    const { db, calls } = fakeDb();
    await eraseAccount(db, "u1", { eraseHistory: true, deleteEmptyOneOnOneGroups: ["g9"] });
    expect(calls).toContain("delete groups.id");
    expect(calls.indexOf("delete groups.id")).toBeGreaterThan(calls.indexOf("deleteUser u1"));
  });
});
