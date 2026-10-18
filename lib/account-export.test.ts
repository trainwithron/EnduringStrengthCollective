import { describe, expect, it } from "vitest";
import { collectEverything, deliveryFor, INLINE_LIMIT_BYTES, noteFor, storeAccountExport, sweepAccountExports, type ExportClient } from "@/lib/account-export";

type Row = Record<string, unknown>;
// A fake database: tables of rows, paged the way export_my_data_table pages them; a table can be made to fail.
function fakeClient(tables: Record<string, Row[]>, failing: Record<string, { message: string; code?: string }> = {}, listError = false): ExportClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async rpc(fn, args = {}) {
      if (fn === "export_my_data_tables") {
        if (listError) return { data: null, error: { message: "function does not exist" } };
        return { data: Object.keys(tables).map((k) => ({ tbl: k.split(".")[0], col: k.split(".")[1] })), error: null };
      }
      const key = `${args.p_table}.${args.p_col}`;
      calls.push(`${key}@${args.p_offset}`);
      if (failing[key] && (args.p_offset as number) >= 2) return { data: null, error: failing[key] };
      const all = tables[key] ?? [];
      const offset = args.p_offset as number;
      const limit = args.p_limit as number;
      return { data: { rows: all.slice(offset, offset + limit), more: all.length > offset + limit }, error: null };
    },
  };
}
const rows = (n: number, tag = "r") => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}` }));

describe("collecting a person's download", () => {
  it("reads each table a page at a time and keeps every row", async () => {
    const client = fakeClient({ "a.athlete_id": rows(5), "b.profile_id": rows(1) });
    const out = await collectEverything(client, { pageRows: 2 });
    expect(out?.tables["a.athlete_id"].rows).toHaveLength(5);
    expect(out?.tables["b.profile_id"].rows).toHaveLength(1);
    expect(out?.complete).toBe(true);
    expect(client.calls.filter((c) => c.startsWith("a.athlete_id"))).toEqual(["a.athlete_id@0", "a.athlete_id@2", "a.athlete_id@4"]);
  });

  it("leaves out a table with nothing in it and sorts the rest", async () => {
    const out = await collectEverything(fakeClient({ "z.athlete_id": rows(1), "a.athlete_id": [], "m.profile_id": rows(1) }));
    expect(Object.keys(out!.tables)).toEqual(["m.profile_id", "z.athlete_id"]);
  });

  it("returns null when the list cannot be read, so the short list is still sent", async () => {
    expect(await collectEverything(fakeClient({}, {}, true))).toBeNull();
  });

  it("a table that times out partway keeps what it read, says why, and does not stop the others", async () => {
    const client = fakeClient({ "slow.athlete_id": rows(10), "fine.athlete_id": rows(3) }, { "slow.athlete_id": { message: "canceling statement due to statement timeout", code: "57014" } });
    const out = await collectEverything(client, { pageRows: 2 });
    expect(out?.tables["slow.athlete_id"].rows).toHaveLength(2);
    expect(out?.tables["slow.athlete_id"].truncated).toBe(true);
    expect(out?.tables["slow.athlete_id"].note).toMatch(/too long/);
    expect(out?.tables["fine.athlete_id"].rows).toHaveLength(3);
    expect(out?.complete).toBe(false);
  });

  it("a table that fails on its first page is named, never silently missing", async () => {
    const client = fakeClient({ "bad.athlete_id": rows(5) }, { "bad.athlete_id": { message: "permission denied" } });
    const out = await collectEverything({ rpc: (fn, args) => (fn === "export_my_data_table" ? Promise.resolve({ data: null, error: { message: "permission denied" } }) : client.rpc(fn, args)) });
    expect(out?.tables["bad.athlete_id"]).toMatchObject({ rows: [], truncated: false });
    expect(out?.tables["bad.athlete_id"].note).toMatch(/could not be read/);
    expect(out?.complete).toBe(false);
  });

  it("cuts a huge table at the per-table limit, keeping the newest rows, and says so", async () => {
    const out = await collectEverything(fakeClient({ "big.athlete_id": rows(25) }), { pageRows: 10, maxRowsPerTable: 12 });
    const t = out!.tables["big.athlete_id"];
    expect(t.rows).toHaveLength(12);
    expect(t.rows[0]).toEqual({ id: "r0" });
    expect(t.truncated).toBe(true);
    expect(t.note).toMatch(/newest 12/);
  });

  it("applies a total budget and names the tables it had to leave out", async () => {
    const out = await collectEverything(fakeClient({ "a.athlete_id": rows(8), "b.athlete_id": rows(8) }), { pageRows: 4, maxTotalRows: 10 });
    const sizes = Object.values(out!.tables).map((t) => t.rows.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
    expect(Object.values(out!.tables).some((t) => /size limit/.test(t.note ?? ""))).toBe(true);
    expect(out?.complete).toBe(false);
  });

  it("stops reading when the time runs out and says so", async () => {
    let clock = 0;
    const out = await collectEverything(fakeClient({ "a.athlete_id": rows(6) }), { pageRows: 2, timeBudgetMs: 100, now: () => (clock += 60) });
    expect(out!.tables["a.athlete_id"].note).toMatch(/ran out of time/);
  });

  it("tells a time-out from any other failure", () => {
    expect(noteFor({ message: "x", code: "57014" })).toMatch(/too long/);
    expect(noteFor({ message: "permission denied" })).toMatch(/could not be read/);
  });
});

describe("delivery of a large download", () => {
  it("sends small ones directly and large ones as a link", () => {
    expect(deliveryFor(1000)).toBe("inline");
    expect(deliveryFor(INLINE_LIMIT_BYTES)).toBe("inline");
    expect(deliveryFor(INLINE_LIMIT_BYTES + 1)).toBe("link");
  });

  const fakeStorage = (opts: { uploadError?: boolean; signError?: boolean; files?: { name: string; created_at: string }[] } = {}) => {
    const removed: string[] = [];
    const db = {
      removed,
      storage: {
        from: () => ({
          upload: async () => ({ error: opts.uploadError ? { message: "no" } : null }),
          createSignedUrl: async (_p: string, seconds: number) => (opts.signError ? { data: null, error: { message: "no" } } : { data: { signedUrl: `https://files.example/x?t=${seconds}` }, error: null }),
          list: async () => ({ data: (opts.files ?? []).filter((f) => !removed.includes(f.name)), error: null }),
          remove: async (names: string[]) => {
            removed.push(...names);
            return { error: null };
          },
        }),
      },
    };
    return db;
  };

  it("stores the file privately and returns a short-lived link", async () => {
    expect(await storeAccountExport(fakeStorage(), "u1", "{}")).toBe("https://files.example/x?t=300");
  });

  it("returns null, never a broken link, when storing or signing fails", async () => {
    expect(await storeAccountExport(fakeStorage({ uploadError: true }), "u1", "{}")).toBeNull();
    expect(await storeAccountExport(fakeStorage({ signError: true }), "u1", "{}")).toBeNull();
  });

  it("deletes files older than a day and leaves newer ones", async () => {
    const now = new Date("2026-10-18T12:00:00Z");
    const db = fakeStorage({
      files: [
        { name: "old-1.json", created_at: "2026-10-16T12:00:00Z" },
        { name: "new-1.json", created_at: "2026-10-18T11:00:00Z" },
      ],
    });
    expect(await sweepAccountExports(db, now)).toBe(1);
    expect(db.removed).toEqual(["old-1.json"]);
  });
});
