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

import { storeExitExport, sweepOrphanExports } from "./leaving-coach-export";

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

describe("storing the coach's one export", () => {
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

describe("sweeping files nothing points at", () => {
  it("removes an old file with no membership row, keeps a recorded one and a brand-new one", async () => {
    const removed: string[][] = [];
    const old = new Date(Date.now() - 5 * 3600_000).toISOString();
    const fresh = new Date(Date.now() - 60_000).toISOString();
    const fake = {
      from: () => ({ select: () => ({ not: async () => ({ data: [{ export_path: "c1/o1.zip" }] }) }) }),
      storage: {
        from: () => ({
          list: async (folder: string) =>
            folder === ""
              ? { data: [{ name: "c1", id: null }, { name: "c2", id: null }] }
              : folder === "c1"
              ? { data: [{ name: "o1.zip", created_at: old }, { name: "o9.zip", created_at: old }] }
              : { data: [{ name: "new.zip", created_at: fresh }] },
          remove: async (paths: string[]) => (removed.push(paths), { error: null }),
        }),
      },
    };
    expect(await sweepOrphanExports(fake)).toBe(1);
    expect(removed).toEqual([["c1/o9.zip"]]);
  });
});
