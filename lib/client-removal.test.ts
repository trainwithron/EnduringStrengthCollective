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

// A stand-in database that remembers: the removal rows, the memberships people still have, the groups and the note that outlives a person. It understands just the calls the job makes.
type Row = Record<string, any>;
function world(opts: { memberships?: Row[]; removals?: Row[]; groups?: Row[]; failLog?: boolean; failMemberships?: boolean }) {
  const tables: Record<string, Row[]> = {
    client_removals: (opts.removals ?? [{ id: "r1", group_id: "g", athlete_id: "a", erase_history: false, delete_after: "2026-11-01T00:00:00Z" }]).map((r) => ({ restored_at: null, purged_at: null, erasing_since: null, delete_after: null, ...r })),
    group_memberships: opts.memberships ?? [],
    groups: opts.groups ?? [{ id: "g", group_kind: "team" }],
    client_removal_log: [],
  };
  const db = {
    tables,
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "update" | "insert" = "select";
      let values: Row = {};
      let head = false;
      let lim = Infinity;
      const q: any = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        not: (c: string) => (filters.push((r) => r[c] != null), q),
        lte: (c: string, v: string) => (filters.push((r) => r[c] <= v), q),
        or: (expr: string) => {
          const cutoff = /erasing_since\.lt\.(.+)$/.exec(expr)?.[1] ?? "";
          filters.push((r) => r.erasing_since == null || r.erasing_since < cutoff);
          return q;
        },
        order: () => q,
        limit: (n: number) => ((lim = n), q),
        update: (v: Row) => ((op = "update"), (values = v), q),
        insert: (v: Row) => ((op = "insert"), (values = v), q),
        single: async () => run().then((r: any) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })),
        maybeSingle: async () => run().then((r: any) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })),
        then: (resolve: (v: unknown) => void) => run().then(resolve),
      };
      async function run(): Promise<any> {
        if (table === "client_removal_log" && op === "insert" && opts.failLog) return { data: null, error: { message: "x" } };
        if (table === "group_memberships" && op === "select" && opts.failMemberships) return { data: null, error: { message: "x" } };
        if (op === "insert") {
          const row = { id: "log" + (tables[table].length + 1), ...values };
          tables[table].push(row);
          return { data: [row], error: null };
        }
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of rows) Object.assign(r, values);
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        if (head) return { count: rows.length, data: [], error: null };
        return { data: rows.slice(0, lim), error: null };
      }
      return q;
    },
  };
  return { db, row: (id = "r1") => tables.client_removals.find((r) => r.id === id)!, log: () => tables.client_removal_log };
}

const removal = { id: "r1", group_id: "g", athlete_id: "a", erase_history: false };
const NOW = new Date("2026-11-20T12:00:00Z");
const WEEK = new Date(NOW.getTime() + 7 * 86400000).toISOString();

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
    expect(REMOVE_CONFIRM("Sam")).toContain("upcoming sessions with you are cancelled");
    expect(DELETE_CONFIRM("Sam")).toContain("live subscription");
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
    expect(removalLine({ removedAt: "2026-11-01T00:00:00Z", deleteAfter: null, cancelledBookings: 3 }, NOW)).toContain("3 upcoming sessions were cancelled and the credits returned.");
    expect(removalLine({ removedAt: "2026-11-01T00:00:00Z", deleteAfter: "2026-11-30T12:00:00Z", erasing: true }, NOW)).toContain("Being deleted right now");
  });
});

describe("the scheduled erase after 30 days", () => {
  it("erases the account when nothing stands in the way, with the coach's choice about history, leaving a person-free note", async () => {
    const w = world({});
    expect(await purgeOneRemoval(w.db, { ...removal, erase_history: true }, NOW)).toBe("erased");
    expect(acct.erase).toHaveBeenCalledWith(w.db, "a", { eraseHistory: true, deleteEmptyOneOnOneGroups: [], spacesBeforeDelete: true });
    expect(w.log()).toHaveLength(1);
    expect(w.log()[0]).toMatchObject({ removal_id: "r1", group_id: "g", outcome: "erased" });
    expect(Object.keys(w.log()[0]).join()).not.toMatch(/name|email/);
  });

  it("the note is written BEFORE anything is erased, and the record is marked erasing before that", async () => {
    const w = world({});
    let during: { marked: unknown; logged: number } | null = null;
    acct.erase.mockImplementationOnce(async () => {
      during = { marked: w.row().erasing_since, logged: w.log().length };
      return { ok: true, error: "" };
    });
    await purgeOneRemoval(w.db, removal, NOW);
    expect(during).toEqual({ marked: NOW.toISOString(), logged: 1 });
  });

  it("a one-on-one space that held only this client goes with them; one that still has a client does not", async () => {
    let w = world({ groups: [{ id: "g", group_kind: "one_on_one" }] });
    await purgeOneRemoval(w.db, removal, NOW);
    expect(acct.erase).toHaveBeenLastCalledWith(w.db, "a", { eraseHistory: false, deleteEmptyOneOnOneGroups: ["g"], spacesBeforeDelete: true });
    w = world({ groups: [{ id: "g", group_kind: "one_on_one" }], memberships: [{ group_id: "g", profile_id: "someone", role: "athlete" }] });
    await purgeOneRemoval(w.db, removal, NOW);
    expect(acct.erase).toHaveBeenLastCalledWith(w.db, "a", { eraseHistory: false, deleteEmptyOneOnOneGroups: [], spacesBeforeDelete: true });
  });

  it("someone who still belongs to another group is NOT erased: only the removal stands, and the record says so", async () => {
    const w = world({ memberships: [{ group_id: "other", profile_id: "a", role: "athlete" }] });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("kept_other_groups");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(w.row()).toMatchObject({ purged_at: NOW.toISOString(), erasing_since: null });
    expect(String(w.row().purge_note)).toContain("account was kept");
  });

  it("another coach's open removal of the same person keeps their account (two groups: one coach deletes, the other only removed)", async () => {
    const other = { id: "r2", group_id: "g2", athlete_id: "a", erase_history: false };
    const w = world({ removals: [{ id: "r1", group_id: "g", athlete_id: "a", erase_history: true, delete_after: "2026-11-01T00:00:00Z" }, other] });
    expect(await purgeOneRemoval(w.db, { ...removal, erase_history: true }, NOW)).toBe("kept_other_groups");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(String(w.row().purge_note)).toContain("Another coach");
    expect(w.row("r2").purged_at ?? null).toBeNull();
    expect(w.log()).toHaveLength(0);
  });

  it("an account that can't be deleted here is left, with the reason, and tried again in a week", async () => {
    acct.blocker = "They have a live subscription. Cancel it first.";
    const w = world({});
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("blocked");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(w.row()).toMatchObject({ delete_after: WEEK, erasing_since: null });
    expect(String(w.row().purge_note)).toContain("live subscription");
  });

  it("if it cannot tell where the person belongs, nothing is erased and it tries again", async () => {
    const w = world({ failMemberships: true });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("failed");
    expect(acct.erase).not.toHaveBeenCalled();
    expect(w.row()).toMatchObject({ delete_after: WEEK, erasing_since: null });
  });

  it("if the note that outlives the person cannot be written, nothing is erased", async () => {
    const w = world({ failLog: true });
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("failed");
    expect(acct.erase).not.toHaveBeenCalled();
  });

  it("a failed erase stays marked erasing with the reason (Put back is refused until it finishes) and is retried in a week; the retry finishes the job", async () => {
    acct.erase.mockResolvedValueOnce({ ok: false, error: "Couldn't erase athlete_notes. Their account was not deleted." });
    const w = world({});
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("failed");
    expect(w.row()).toMatchObject({ erasing_since: NOW.toISOString(), delete_after: WEEK });
    expect(String(w.row().purge_note)).toContain("not deleted");
    expect(w.log()[0].outcome).toBe("erasing");
    const later = new Date(NOW.getTime() + 8 * 86400000);
    expect(await purgeOneRemoval(w.db, removal, later)).toBe("erased");
    expect(w.log()).toHaveLength(2);
    expect(w.log()[1].outcome).toBe("erased");
  });

  it("two runs at once never overlap, and a Put back that got in first means nothing is done", async () => {
    const w = world({});
    w.row().erasing_since = new Date(NOW.getTime() - 60000).toISOString();
    expect(await purgeOneRemoval(w.db, removal, NOW)).toBe("skipped");
    const back = world({ removals: [{ id: "r1", group_id: "g", athlete_id: "a", erase_history: false, restored_at: "2026-11-19T00:00:00Z" }] });
    expect(await purgeOneRemoval(back.db, removal, NOW)).toBe("skipped");
    expect(acct.erase).not.toHaveBeenCalled();
  });

  it("each due removal is its own step: one that throws does not stop the rest", async () => {
    const removals = [
      { id: "r1", group_id: "g", athlete_id: "a", erase_history: false, delete_after: "2026-11-01T00:00:00Z" },
      { id: "r2", group_id: "g", athlete_id: "b", erase_history: false, delete_after: "2026-11-02T00:00:00Z" },
    ];
    acct.erase.mockRejectedValueOnce(new Error("boom"));
    const w = world({ removals });
    const tally = await purgeDueRemovals(w.db, NOW);
    expect(tally).toEqual({ checked: 2, erased: 1, kept: 0, blocked: 0, failed: 1, skipped: 0 });
  });
});

describe("how it is wired", () => {
  it("the migration only adds: one table the browser cannot write, and two functions for the coach", () => {
    const sql = src("supabase/migrations/0407_client_removals.sql");
    expect(sql).toContain("revoke all on public.client_removals from anon, authenticated;\ngrant select on public.client_removals to authenticated;");
    expect(sql).toContain("create unique index if not exists client_removals_one_open");
    expect(sql).toContain("if me is null or not public.is_group_coach(p_group) then");
    expect(sql).toContain("delete from public.group_memberships where id = m.id;");
    // the per-client rate would be deleted with the membership (it cascades): it is saved and put back against the new membership
    expect(sql).toContain("select to_jsonb(r) into v_rate from public.client_billing_rates r where r.membership_id = m.id;");
    expect(sql).toContain("insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate, updated_at)");
    // a live subscription in the group refuses the removal; upcoming sessions end with the app's own cancel
    expect(sql).toContain("They have a live subscription. Cancel it first");
    expect(sql).toContain("perform public.cancel_booking_and_refund_credit(b.id);");
    expect(sql).toContain("perform public.cancel_recurring_booking_series(b.id);");
    // an emptied one-on-one space leaves the lists the way a retired team does; a stale open record is closed rather than failing
    expect(sql).toContain("update public.groups set archived_at = now() where id = p_group;");
    expect(sql).toContain("Closed: they became a client of this group again.");
    // restore: only the columns the record holds (so a later column keeps its default), a deleted position is dropped, the erase under way is refused
    expect(sql).toContain("jsonb_object_keys(s)");
    expect(sql).not.toContain("select * from jsonb_populate_record");
    expect(sql).toContain("they can''t be put back");
    // the record's group may be deleted while the erase is retried: it must not cascade away with it
    expect(sql).toContain("group_id uuid references public.groups(id) on delete set null,");
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
