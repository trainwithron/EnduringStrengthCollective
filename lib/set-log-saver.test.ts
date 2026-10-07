import { describe, expect, it, vi } from "vitest";
import { SetLogSaver, SET_LOG_DELETE, deleteSetLogRow, isTerminalSetLogError, writeOrDeleteSetLogRow, writeSetLogRow } from "@/lib/set-log-saver";

// A manual scheduler so retries run exactly when the test says.
function manualScheduler() {
  const timers: { fn: () => void; ms: number; active: boolean }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, active: true };
      timers.push(t);
      return t;
    },
    cancel: (h: unknown) => {
      (h as { active: boolean }).active = false;
    },
    fireNext() {
      const t = timers.find((x) => x.active);
      if (t) {
        t.active = false;
        t.fn();
      }
    },
    pending: () => timers.filter((t) => t.active).map((t) => t.ms),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SetLogSaver", () => {
  it("saves a change and clears it from unsaved once the write succeeds", async () => {
    const write = vi.fn(async () => true);
    const saver = new SetLogSaver({ write });
    saver.queue("s1", { reps: 5 });
    await tick();
    expect(write).toHaveBeenCalledWith("s1", { reps: 5 });
    expect(saver.unsaved).toEqual([]);
  });

  it("keeps a failed change as unsaved, retries with backoff, and saves when the signal returns", async () => {
    const sched = manualScheduler();
    let up = false;
    const write = vi.fn(async () => up);
    const saver = new SetLogSaver({ write, ...sched, backoffMs: [1000, 3000] });
    saver.queue("s1", { weight: 185 });
    await tick();
    expect(saver.unsaved).toEqual(["s1"]);
    expect(saver.failed).toEqual(["s1"]);
    expect(sched.pending()).toEqual([1000]);

    sched.fireNext();
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(sched.pending()).toEqual([3000]);

    up = true;
    sched.fireNext();
    await tick();
    expect(saver.unsaved).toEqual([]);
  });

  it("stops retrying after the backoff is exhausted but keeps the change for a manual retry", async () => {
    const sched = manualScheduler();
    let up = false;
    const write = vi.fn(async () => up);
    const saver = new SetLogSaver({ write, ...sched, backoffMs: [100] });
    saver.queue("s1", { reps: 8 });
    await tick();
    sched.fireNext();
    await tick();
    expect(sched.pending()).toEqual([]); // exhausted
    expect(saver.unsaved).toEqual(["s1"]);

    up = true;
    saver.retryAll();
    await tick();
    expect(saver.unsaved).toEqual([]);
  });

  it("merges edits to the same set and never loses a newer edit to an older in-flight write", async () => {
    const calls: Record<string, unknown>[] = [];
    let release: (v: boolean) => void = () => {};
    const write = vi.fn((_id: string, payload: Record<string, unknown>) => {
      calls.push(payload);
      if (calls.length === 1) return new Promise<boolean>((r) => (release = r));
      return Promise.resolve(true);
    });
    const saver = new SetLogSaver({ write });
    saver.queue("s1", { reps: 5 });
    await tick();
    saver.queue("s1", { weight: 200 }); // arrives while the first write is in flight
    release(true);
    await tick();
    await tick();
    expect(calls[calls.length - 1]).toEqual({ reps: 5, weight: 200 });
    expect(saver.unsaved).toEqual([]);
  });

  it("flush resolves false while changes can't be saved, true once they can", async () => {
    let up = false;
    const sched = manualScheduler();
    const saver = new SetLogSaver({ write: async () => up, ...sched });
    saver.queue("s1", { reps: 5 });
    await tick();
    expect(await saver.flush()).toBe(false);
    up = true;
    expect(await saver.flush()).toBe(true);
    expect(saver.unsaved).toEqual([]);
  });

  it("a thrown write counts as a failure, not a crash", async () => {
    const sched = manualScheduler();
    const saver = new SetLogSaver({
      write: async () => {
        throw new Error("network down");
      },
      ...sched,
    });
    saver.queue("s1", { reps: 1 });
    await tick();
    expect(saver.failed).toEqual(["s1"]);
  });

  it("reports state changes to the UI", async () => {
    const states: { unsaved: string[]; failed: string[] }[] = [];
    const saver = new SetLogSaver({ write: async () => false, ...manualScheduler(), onChange: (s) => states.push(s) });
    saver.queue("s1", { reps: 1 });
    await tick();
    expect(states[0]).toEqual({ unsaved: ["s1"], failed: [] });
    expect(states[states.length - 1]).toEqual({ unsaved: ["s1"], failed: ["s1"] });
  });
});

describe("writeSetLogRow", () => {
  const client = (result: { data: unknown[] | null; error: unknown }) => ({
    from: () => ({ update: () => ({ eq: () => ({ select: async () => result }) }) }),
  });

  it("is saved only when exactly one row was updated", async () => {
    expect(await writeSetLogRow(client({ data: [{ id: "s1" }], error: null }), "s1", {})).toBe(true);
  });

  it("treats a 0-row update (blocked by RLS, row gone) as a failure", async () => {
    expect(await writeSetLogRow(client({ data: [], error: null }), "s1", {})).toBe(false);
  });

  it("treats an error as a failure", async () => {
    expect(await writeSetLogRow(client({ data: null, error: { message: "boom" } }), "s1", {})).toBe(false);
  });
});

describe("discard", () => {
  it("drops pending saves for removed sets so they stop blocking completion", async () => {
    const calls: string[] = [];
    const saver = new SetLogSaver({
      write: async (id) => {
        calls.push(id);
        return false; // the row was deleted: zero rows updated
      },
      backoffMs: [],
      schedule: () => 0,
      cancel: () => {},
    });
    saver.queue("gone", { reps: 5 });
    await Promise.resolve();
    expect(saver.unsaved).toEqual(["gone"]);
    saver.discard(["gone", "never-queued"]);
    expect(saver.unsaved).toEqual([]);
    expect(saver.failed).toEqual([]);
    expect(await saver.flush()).toBe(true);
  });
});

describe("removing a set rides the same queue", () => {
  it("queues a delete, retries it on a bad signal, and clears it once the database confirms", async () => {
    const sched = manualScheduler();
    let up = false;
    const write = vi.fn(async (_id: string, payload: Record<string, unknown>) => up && payload[SET_LOG_DELETE] === true);
    const saver = new SetLogSaver({ write, ...sched, backoffMs: [1000] });
    saver.queue("s3", { [SET_LOG_DELETE]: true });
    await tick();
    expect(saver.unsaved).toEqual(["s3"]);
    expect(saver.failed).toEqual(["s3"]);
    up = true;
    saver.retryAll();
    await tick();
    expect(saver.unsaved).toEqual([]);
  });

  it("a delete wins over an edit queued for the same set", async () => {
    const write = vi.fn(async (_id: string, _payload: Record<string, unknown>) => false);
    const saver = new SetLogSaver({ write, backoffMs: [] });
    saver.queue("s3", { reps: 5 });
    saver.queue("s3", { [SET_LOG_DELETE]: true });
    await tick();
    saver.retryAll();
    await tick();
    const calls = write.mock.calls;
    expect(calls[calls.length - 1][1][SET_LOG_DELETE]).toBe(true);
  });
});

describe("deleteSetLogRow / writeOrDeleteSetLogRow", () => {
  function client(result: { data: unknown[] | null; error: unknown }, seen: string[] = []) {
    return {
      from: (table: string) => ({
        update: () => ({
          eq: () => ({
            select: async () => {
              seen.push(`update ${table}`);
              return result;
            },
          }),
        }),
        delete: () => ({
          eq: (_c: string, v: string) => ({
            select: async () => {
              seen.push(`delete ${table} ${v}`);
              return result;
            },
          }),
        }),
      }),
    };
  }
  it("a delete counts as done whether one row or none was left to delete (a retry after it landed must not fail forever)", async () => {
    expect(await deleteSetLogRow(client({ data: [{ id: "s3" }], error: null }), "s3")).toBe(true);
    expect(await deleteSetLogRow(client({ data: [], error: null }), "s3")).toBe(true);
  });
  it("a database error stays a failure", async () => {
    expect(await deleteSetLogRow(client({ data: null, error: { message: "blocked" } }), "s3")).toBe(false);
  });
  it("a finished workout is terminal: it counts as done (so Complete is never blocked forever) and the screen is told to reload", async () => {
    let told = 0;
    const ok = await deleteSetLogRow(client({ data: null, error: { message: "This workout was already completed." } }), "s3", () => (told += 1));
    expect(ok).toBe(true);
    expect(told).toBe(1);
    expect(isTerminalSetLogError({ message: "This workout was already completed." })).toBe(true);
    expect(isTerminalSetLogError({ message: "network down" })).toBe(false);
    expect(isTerminalSetLogError(null)).toBe(false);
  });
  it("routes a delete marker to a delete and anything else to an update", async () => {
    const seen: string[] = [];
    await writeOrDeleteSetLogRow(client({ data: [{ id: "s3" }], error: null }, seen), "s3", { [SET_LOG_DELETE]: true });
    await writeOrDeleteSetLogRow(client({ data: [{ id: "s3" }], error: null }, seen), "s3", { reps: 5 });
    expect(seen).toEqual(["delete set_logs s3", "update set_logs"]);
  });
});
