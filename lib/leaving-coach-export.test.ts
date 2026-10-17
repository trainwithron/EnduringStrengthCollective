import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ failedParts: [] as string[], uploads: [] as string[], uploadError: null as { message: string } | null }));

vi.mock("@/lib/business-export", () => ({
  exportEntries: (deps: { report?: { failed: string[] } }) => ({
    async *[Symbol.asyncIterator]() {
      if (deps.report) deps.report.failed = state.failedParts;
      yield { name: "a.csv", chunks: (async function* () { yield new Uint8Array([1, 2, 3]); })() };
    },
  }),
}));
vi.mock("@/lib/zip-store", () => ({
  zipStream: (entries: AsyncIterable<unknown>) =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const _ of entries) void _;
        controller.enqueue(new Uint8Array([9, 9, 9, 9]));
        controller.close();
      },
    }),
}));

import { emailsForExport, storeExitExport, sweepOrphanExports } from "./leaving-coach-export";

const db = (extra: Record<string, unknown> = {}) => ({
  auth: { admin: { getUserById: async () => ({ data: { user: { email: "x@example.com" } } }) } },
  storage: {
    from: () => ({
      upload: async (path: string) => {
        state.uploads.push(path);
        return { error: state.uploadError };
      },
    }),
  },
  ...extra,
});

beforeEach(() => {
  state.failedParts = [];
  state.uploads = [];
  state.uploadError = null;
});

describe("storing the coach export", () => {
  it("stores a complete export and returns where", async () => {
    const path = await storeExitExport(db(), { coachId: "c1", organizationId: "o1", groupIds: ["g1"], orgName: "Gym" });
    expect(path).toBe("c1/o1.zip");
    expect(state.uploads).toEqual(["c1/o1.zip"]);
  });
  it("never stores an incomplete one: a part that could not be read counts as a failed try", async () => {
    state.failedParts = ["notes"];
    expect(await storeExitExport(db(), { coachId: "c1", organizationId: "o1", groupIds: ["g1"], orgName: "Gym" })).toBeNull();
    expect(state.uploads).toEqual([]);
  });
  it("an upload that fails is a failed try too", async () => {
    state.uploadError = { message: "nope" };
    expect(await storeExitExport(db(), { coachId: "c1", organizationId: "o1", groupIds: ["g1"], orgName: "Gym" })).toBeNull();
  });
});

const recordedRead = (rows: unknown[] | null, error: unknown = null) => ({
  select: () => ({ not: () => ({ order: () => ({ range: async () => ({ data: rows, error }) }) }) }),
});
const storageOf = (removed: string[][], files: Record<string, unknown[]>) => ({
  from: () => ({
    list: async (folder: string) => (folder === "" ? { data: Object.keys(files).map((name) => ({ name, id: null })) } : { data: files[folder] ?? [] }),
    remove: async (paths: string[]) => (removed.push(paths), { error: null }),
  }),
});
const old = new Date(Date.now() - 5 * 3600_000).toISOString();
const fresh = new Date(Date.now() - 60_000).toISOString();

describe("sweeping files nothing points at", () => {
  it("removes an old file with no membership row, keeps a recorded one, a brand-new one and one with no age", async () => {
    const removed: string[][] = [];
    const fake = {
      from: () => recordedRead([{ export_path: "c1/o1.zip", profile_id: "c1" }]),
      storage: storageOf(removed, { c1: [{ name: "o1.zip", created_at: old }, { name: "o9.zip", created_at: old }, { name: "undated.zip" }], c2: [{ name: "new.zip", created_at: fresh }] }),
    };
    expect(await sweepOrphanExports(fake)).toBe(1);
    expect(removed).toEqual([["c1/o9.zip"]]);
  });
  it("deletes nothing when the list of recorded files could not be read", async () => {
    const removed: string[][] = [];
    const fake = { from: () => recordedRead(null, { message: "down" }), storage: storageOf(removed, { c1: [{ name: "o9.zip", created_at: old }] }) };
    expect(await sweepOrphanExports(fake)).toBe(0);
    expect(removed).toEqual([]);
  });
  it("deletes nothing when the read may have been cut short", async () => {
    const removed: string[][] = [];
    const full = Array.from({ length: 1000 }, (_, i) => ({ export_path: `x/${i}.zip`, profile_id: "p" + i }));
    // every page comes back full, so the read hit its cap
    const fake = { from: () => recordedRead(full), storage: storageOf(removed, { c1: [{ name: "o9.zip", created_at: old }] }) };
    expect(await sweepOrphanExports(fake)).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe("the client emails in the export", () => {
  const dbWith = (getUserById: (id: string) => Promise<unknown>) => ({ auth: { admin: { getUserById } } }) as any;
  it("finds the real ones and skips placeholders", async () => {
    const found = await emailsForExport(dbWith(async (id) => ({ data: { user: { email: id === "a" ? "a@example.com" : "client-1@pending.invalid" } } })))(["a", "b"]);
    expect([...found.entries()]).toEqual([["a", "a@example.com"]]);
  });
  it("a lookup that fails makes the export fail (it is never kept with a blank email cell)", async () => {
    await expect(emailsForExport(dbWith(async () => ({ data: null, error: { status: 500, message: "boom" } })))(["a"])).rejects.toThrow();
  });
  it("a client whose account is gone just has no email", async () => {
    const found = await emailsForExport(dbWith(async () => ({ data: null, error: { status: 404, message: "User not found" } })))(["a"]);
    expect(found.size).toBe(0);
  });
});
