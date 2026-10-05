import { describe, expect, it, vi } from "vitest";
import { SetLogSaver, writeSetLogRow } from "@/lib/set-log-saver";

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
