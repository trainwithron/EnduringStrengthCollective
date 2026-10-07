import { describe, expect, it, vi } from "vitest";
import { createNoteAutosaver } from "@/lib/note-autosave";

function manual() {
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
    fire() {
      const t = timers.find((x) => x.active);
      if (t) {
        t.active = false;
        t.fn();
      }
    },
    pending: () => timers.filter((t) => t.active).length,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the note autosaver", () => {
  it("saves after typing pauses, not on every keystroke", async () => {
    const m = manual();
    const write = vi.fn(async () => true);
    const s = createNoteAutosaver({ initial: null, write, schedule: m.schedule, cancel: m.cancel });
    s.change("Shoul");
    s.change("Shoulder felt");
    s.change("Shoulder felt tight");
    expect(write).not.toHaveBeenCalled();
    expect(m.pending()).toBe(1); // only the latest pause timer is alive
    m.fire();
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("Shoulder felt tight");
    expect(s.isDirty()).toBe(false);
  });

  it("dictation then an immediate tap elsewhere: the blur reads the value from the field and saves all of it, even if the pause timer never fired", async () => {
    const m = manual();
    const write = vi.fn(async () => true);
    const s = createNoteAutosaver({ initial: "Felt good", write, schedule: m.schedule, cancel: m.cancel });
    s.change("Felt good"); // a stale copy
    const ok = await s.flush("Felt good. Left shoulder was tight on the last set and I stopped at four reps"); // what the field really holds on blur
    expect(ok).toBe(true);
    expect(write).toHaveBeenLastCalledWith("Felt good. Left shoulder was tight on the last set and I stopped at four reps");
    expect(m.pending()).toBe(0);
  });

  it("a slow older save never overwrites a newer one: saves go one at a time and the newest text wins", async () => {
    const m = manual();
    const sent: (string | null)[] = [];
    let release: () => void = () => {};
    const write = vi.fn(async (v: string | null) => {
      sent.push(v);
      if (sent.length === 1) await new Promise<void>((r) => (release = r));
      return true;
    });
    const s = createNoteAutosaver({ initial: null, write, schedule: m.schedule, cancel: m.cancel });
    s.change("first");
    const first = s.flush();
    await tick();
    const second = s.flush("first and then more");
    await tick();
    expect(sent).toEqual(["first"]); // the second waits for the first
    release();
    await first;
    await second;
    expect(sent).toEqual(["first", "first and then more"]);
    expect(s.isDirty()).toBe(false);
  });

  it("an unchanged note is not written again", async () => {
    const write = vi.fn(async () => true);
    const s = createNoteAutosaver({ initial: "Same", write });
    expect(await s.flush("Same")).toBe(true);
    expect(await s.flush("  Same  ")).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("clearing the note saves null", async () => {
    const write = vi.fn(async () => true);
    const s = createNoteAutosaver({ initial: "Old note", write });
    await s.flush("   ");
    expect(write).toHaveBeenCalledWith(null);
  });

  it("a failed save leaves the text marked unsaved and the next chance tries again", async () => {
    const statuses: string[] = [];
    let up = false;
    const write = vi.fn(async () => up);
    const s = createNoteAutosaver({ initial: null, write, onStatus: (st) => statuses.push(st) });
    expect(await s.flush("Heavy day")).toBe(false);
    expect(s.isDirty()).toBe(true);
    up = true;
    expect(await s.flush("Heavy day")).toBe(true);
    expect(s.isDirty()).toBe(false);
    expect(statuses).toEqual(["saving", "error", "saving", "saved"]);
  });

  it("a write that throws counts as a failure, not a crash", async () => {
    const s = createNoteAutosaver({ initial: null, write: async () => { throw new Error("offline"); } });
    expect(await s.flush("x")).toBe(false);
    expect(s.isDirty()).toBe(true);
  });

  it("after dispose it stops reporting status but a final flush still saves (leaving the screen)", async () => {
    const statuses: string[] = [];
    const write = vi.fn(async () => true);
    const s = createNoteAutosaver({ initial: null, write, onStatus: (st) => statuses.push(st) });
    s.change("Leaving now");
    s.dispose();
    await s.flush();
    expect(write).toHaveBeenCalledWith("Leaving now");
    expect(statuses).toEqual([]);
  });
});

describe("retrying a failed note save", () => {
  it("retries by itself after 2, 6 and 15 seconds, then stops until the next change, blur or Retry", async () => {
    const m = manual();
    const write = vi.fn(async () => false);
    const s = createNoteAutosaver({ initial: null, write, schedule: m.schedule, cancel: m.cancel });
    await s.flush("Offline note");
    expect(write).toHaveBeenCalledTimes(1);
    expect(m.pending()).toBe(1);
    m.fire();
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    m.fire();
    await tick();
    expect(write).toHaveBeenCalledTimes(3);
    m.fire();
    await tick();
    expect(write).toHaveBeenCalledTimes(4);
    expect(m.pending()).toBe(0); // exhausted: waits for the next chance
    expect(s.isDirty()).toBe(true);
  });

  it("saves as soon as the signal returns, and the Retry button works at any time", async () => {
    const m = manual();
    let up = false;
    const write = vi.fn(async () => up);
    const s = createNoteAutosaver({ initial: null, write, schedule: m.schedule, cancel: m.cancel });
    await s.flush("Heavy day");
    up = true;
    expect(await s.retry()).toBe(true);
    expect(s.isDirty()).toBe(false);
  });

  it("new text restarts the retry count", async () => {
    const m = manual();
    const write = vi.fn(async () => false);
    const s = createNoteAutosaver({ initial: null, write, schedule: m.schedule, cancel: m.cancel, retryDelaysMs: [1000] });
    await s.flush("a");
    m.fire();
    await tick();
    expect(m.pending()).toBe(0);
    s.change("a b");
    expect(m.pending()).toBe(1);
  });
});

describe("reopening after a dispose (React StrictMode)", () => {
  it("status reports and retries work again after dispose then reopen", async () => {
    const m = manual();
    const statuses: string[] = [];
    let up = false;
    const write = vi.fn(async () => up);
    const s = createNoteAutosaver({ initial: null, write, onStatus: (st) => statuses.push(st), schedule: m.schedule, cancel: m.cancel });
    s.dispose();
    s.reopen();
    await s.flush("Back again");
    expect(statuses).toEqual(["saving", "error"]);
    expect(m.pending()).toBe(1); // the retry is scheduled again
    up = true;
    m.fire();
    await tick();
    expect(s.isDirty()).toBe(false);
  });
});
