import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DELETE_CONFIRM, REMOVE_CONFIRM, UNDO_DAYS, daysLeft, removalLine } from "./client-removal";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const acct = vi.hoisted(() => ({
  blocker: null as string | null,
  erase: vi.fn(async () => ({ ok: true as boolean, error: "x" })),
}));
vi.mock("@/lib/account-deletion", () => ({
  loadDeletionFacts: async () => ({}),
  deletionBlocker: () => acct.blocker,
  eraseAccount: (...args: unknown[]) => (acct.erase as any)(...args),
}));
import { purgeDueRemovals, purgeOneRemoval } from "./client-removal-server";

// A stand-in database: the memberships the person still has, the removal rows and what is written back to them.
function world(opts: { stillIn?: unknown[]; stillError?: boolean; groupKind?: string; athletesLeft?: number; due?: { id: string; group_id: string; athlete_id: string; erase_history: boolean }[] }) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const f: Record<string, unknown> = {};
      const q: any = {
        _op: "select",
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        is: () => q,
        not: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        update: (values: Record<string, unknown>) => ((q._op = "update"), (q._values = values), q),
        maybeSingle: async () => ({ data: table === "groups" ? { id: "g", group_kind: opts.groupKind ?? "team" } : null }),
        then(resolve: (v: unknown) => void) {
          if (q._op === "update") {
            updates.push({ id: f.id as string, values: q._values });
            return resolve({ data: null, error: null });
          }
          if (table === "client_removals") return resolve({ data: opts.due ?? [], error: null });
          if (table === "group_memberships" && f.group_id) return resolve({ count: opts.athletesLeft ?? 0, data: [], error: null });
          if (table === "group_memberships") return resolve({ data: opts.stillIn ?? [], error: opts.stillError ? { message: "x" } : null });
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  return { db, updates };
}

const removal = { id: "r1", group_id: "g", athlete_id: "a", erase_history: false };
const NOW = new Date("2026-11-20T12:00:00Z");

beforeEach(() => {
  acct.blocker = null;
  acct.erase.mockReset();
  acct.erase.mockResolvedValue({ ok: true, error: "" });
});

describe("the words", () => {
  it("say what is kept, what can be undone, and for how long", () => {
    expect(UNDO_DAYS).toBe(30);
    expect(REMOVE_CONFIRM("Sam")).toContain("Their account and everything about them are kept");
    expect(REMOVE_CONFIRM("Sam")).toContain("put them back whenever you like");
    expect(DELETE_CONFIRM("Sam")).toContain("You have 30 days to change your mind");
    expect(DELETE_CONFIRM("Sam")).toContain("cannot be brought back");
  });

  it("count the days left and read plainly", () => {
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft("2026-11-30T12:00:00Z", NOW)).toBe(10);
    expect(daysLeft("2026-11-20T12:30:00Z", NOW)).toBe(1);
    expect(daysLeft("2026-11-01T00:00:00Z", NOW)).toBe(0);
    expect(removalLine({ removedAt: "2026-11-01T00:00:00Z", deleteAfter: "2026-11-30T12:00:00Z" }, NOW)).toBe("Deleted for good in 10 days unless you put them back.");
    expect(removalLine({ removedAt: "2026-11-01T00:00:00Z", deleteAfter: "2026-11-21T00:00:00Z" }, NOW)).toBe("Deleted for good in 1 day unless you put them back.");
    expect(removalLine({ removedAt: "2026-11-01T00:00:00Z", deleteAfter: null }, NOW)).toContain("Their account and data are kept.");
  });
});

describe("the scheduled erase after 30 days", () => {
  it("erases the account when nothing stands in the way, with the coach's choice about history", async () => {
    const w = world({ stillIn: [] });
    expect(await purgeOneRemoval(w.db, { ...removal, erase_history: true }, NOW)).toBe("erased");
    expect(acct.erase).toHaveBeenCalledWith(w.db, "a", { eraseHistory: true, deleteEmptyOneOnOneGroups: [] });
  });

  it("a one-on-one space that held only this client goes with them; one that still has a client does not", async () => {
    let w = world({ stillIn: [], groupKind: "one_on_one", athletesLeft: 0 });
    await purgeOneRemoval(w.db, removal, NOW);
    expect(acct.erase).toHaveBeenLastCalledWith(w.db, "a", { eraseHistory: false, deleteEmptyOneOnOneGroups: ["g"] });
    w = world({ stillIn: [], groupKind: "one_on_one", athletesLeft: 1 });
    await purgeOneRemoval(w.db, removal, NOW);
    expect(acct.erase).toHaveBeenLastCalledWith(w.db, "a", { eraseHistory: false, deleteEmptyOneOnOneGroups: [] });
  });

  it("someone who still belongs to another group is NOT erased: only the removal stands, and the record says so", async () => {
    const w = world({ stillIn: [{ group_id: "other" }] });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("kept_other_groups");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(w.updates[0].values).toMatchObject({ purged_at: NOW.toISOString() });
    expect(String(w.updates[0].values.purge_note)).toContain("account was kept");
  });

  it("an account that can't be deleted here is left, with the reason, and tried again in a week", async () => {
    acct.blocker = "They have a live subscription. Cancel it first.";
    const w = world({ stillIn: [] });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("blocked");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(w.updates[0].values.delete_after).toBe(new Date(NOW.getTime() + 7 * 86400000).toISOString());
    expect(String(w.updates[0].values.purge_note)).toContain("live subscription");
  });

  it("if it cannot tell where the person belongs, or the erase fails, nothing is lost and it tries again", async () => {
    const unknown = world({ stillError: true });
    expect(await purgeOneRemoval(unknown.db, removal, NOW)).toBe("failed");
    expect(acct.erase).not.toHaveBeenCalled();
    acct.erase.mockResolvedValueOnce({ ok: false, error: "Couldn't erase athlete_notes. Their account was not deleted." });
    const w = world({ stillIn: [] });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("failed");
    expect(String(w.updates[0].values.purge_note)).toContain("not deleted");
  });

  it("each due removal is its own step: one that throws does not stop the rest", async () => {
    const due = [
      { id: "r1", group_id: "g", athlete_id: "a", erase_history: false },
      { id: "r2", group_id: "g", athlete_id: "b", erase_history: false },
    ];
    acct.erase.mockRejectedValueOnce(new Error("boom"));
    const w = world({ stillIn: [], due });
    const tally = await purgeDueRemovals(w.db, NOW);
    expect(tally).toEqual({ checked: 2, erased: 1, kept: 0, blocked: 0, failed: 1 });
  });
});

describe("how it is wired", () => {
  it("the migration only adds: one table the browser cannot write, and two functions for the coach", () => {
    const sql = src("supabase/migrations/0407_client_removals.sql");
    expect(sql).toContain("revoke all on public.client_removals from anon, authenticated;\ngrant select on public.client_removals to authenticated;");
    expect(sql).toContain("create unique index if not exists client_removals_one_open");
    expect(sql).toContain("if me is null or not public.is_group_coach(p_group) then");
    expect(sql).toContain("delete from public.group_memberships where id = m.id;");
    expect(sql).toContain("now() + interval '30 days'");
    expect(sql).not.toMatch(/delete from (auth|public\.profiles)/);
  });

  it("the daily job is registered and is the only thing that erases a removed client", () => {
    expect(src("vercel.json")).toContain("/api/cron/purge-removed-clients");
    expect(src("lib/cron-jobs.ts")).toContain('job: "purge-removed-clients"');
    const route = src("app/api/cron/purge-removed-clients/route.ts");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("purgeDueRemovals(");
    // the coach-facing routes never call the eraser
    for (const f of ["app/api/clients/remove/route.ts", "app/api/clients/restore/route.ts"]) expect(src(f), f).not.toMatch(/eraseAccount|deleteUser/);
  });

  it("the menu, the profile and the Members page offer Remove first and Delete permanently second, and list who was removed with Put back", () => {
    expect(src("components/coach/delete-client-control.tsx")).toContain("runRemoveClient(");
    expect(src("components/coach/delete-client-control.tsx")).toContain("runDeleteClient(");
    const page = src("app/(coach)/groups/[groupId]/clients/page.tsx");
    expect(page).toContain("<RemovedClientsPanel removals={removed} />");
    expect(page).toContain('.is("restored_at", null).is("purged_at", null)');
    expect(src("components/coach/desktop/removed-clients-panel.tsx")).toContain('"/api/clients/restore"');
  });
});
