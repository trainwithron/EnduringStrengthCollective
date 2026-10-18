import { describe, it, expect } from "vitest";
import { sendGraduationHistories, WHY, type SendDeps } from "./graduation-send";

// A stand-in for the database and the mail service. The claim set is shared, like the unique row, so two calls at once compete for it.
function world(over: Partial<SendDeps> = {}, opts: { noAddress?: string[]; sendFails?: string[]; truncated?: string[] } = {}) {
  const claims = new Map<string, "claimed" | "sent">();
  const mails: string[] = [];
  const deps: SendDeps = {
    addressOf: async (id) => (opts.noAddress?.includes(id) ? null : `${id}@example.com`),
    claim: async (id) => {
      await Promise.resolve(); // let the other call run between "look" and "take", as the database does
      if (claims.has(id)) return "taken";
      claims.set(id, "claimed");
      return "claimed";
    },
    release: async (id) => void (claims.get(id) === "claimed" && claims.delete(id)),
    markSent: async (id) => void claims.set(id, "sent"),
    history: async (id) => ({ sessions: [], failed: false, truncated: !!opts.truncated?.includes(id) }),
    weightUnit: async () => "lb",
    send: async (to, a) => {
      if (opts.sendFails?.includes(a.id)) return false;
      mails.push(to);
      return true;
    },
    ...over,
  };
  return { deps, claims, mails };
}

const people = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];

describe("emailing the graduating players", () => {
  it("sends each once and marks them sent", async () => {
    const w = world();
    const r = await sendGraduationHistories(people, w.deps);
    expect(r).toEqual({ sent: 3, skipped: 0, problems: [], remaining: 0 });
    expect(w.mails.length).toBe(3);
    expect([...w.claims.values()].every((v) => v === "sent")).toBe(true);
  });

  it("two calls at once never email anyone twice", async () => {
    const w = world();
    const [x, y] = await Promise.all([sendGraduationHistories(people, w.deps), sendGraduationHistories(people, w.deps)]);
    expect(x.sent + y.sent).toBe(3);
    expect(x.skipped + y.skipped).toBe(3);
    expect(w.mails.length).toBe(3);
    expect(new Set(w.mails).size).toBe(3);
  });

  it("calling again later skips whoever already has theirs", async () => {
    const w = world();
    await sendGraduationHistories(people, w.deps);
    const again = await sendGraduationHistories(people, w.deps);
    expect(again).toEqual({ sent: 0, skipped: 3, problems: [], remaining: 0 });
    expect(w.mails.length).toBe(3);
  });

  it("a send that fails gives the claim back, says why, and works on the next try", async () => {
    const w = world({}, { sendFails: ["b"] });
    const r = await sendGraduationHistories(people, w.deps);
    expect(r.sent).toBe(2);
    expect(r.problems).toEqual([{ name: "Bo", why: WHY.sendFailed }]);
    expect(w.claims.has("b")).toBe(false);
    const retry = await sendGraduationHistories(people, world({}, {}).deps);
    expect(retry.problems).toEqual([]);
  });

  it("a player with no usable address, and a history too long or unreadable to send whole, are listed with the reason and never claimed", async () => {
    const w = world({}, { noAddress: ["a"], truncated: ["c"] });
    const r = await sendGraduationHistories(people, w.deps);
    expect(r.sent).toBe(1);
    expect(r.problems).toEqual([
      { name: "Ann", why: WHY.noAddress },
      { name: "Cy", why: WHY.tooLong },
    ]);
    expect(w.mails).toEqual(["b@example.com"]);
    expect(w.claims.has("a")).toBe(false);
    expect(w.claims.has("c")).toBe(false);
  });

  it("a class of 95 is sent across three calls, every player exactly once, and players who cannot be sent to never stall the batch", async () => {
    const all = Array.from({ length: 95 }, (_, i) => ({ id: "p" + i, name: "Player " + i }));
    const noAddress = ["p3", "p10", "p50", "p51", "p94"];
    const w = world({}, { noAddress });
    const reported = new Map<string, number>();
    let calls = 0;
    let last = { sent: 0, remaining: 1 };
    while (last.remaining > 0 || last.sent > 0) {
      calls++;
      expect(calls).toBeLessThan(6);
      // what the route does before cutting the batch: leave out players already sent
      const todo = all.filter((p) => w.claims.get(p.id) !== "sent");
      const r = await sendGraduationHistories(todo, w.deps, { limit: 40 });
      for (const p of r.problems) reported.set(p.name, (reported.get(p.name) ?? 0) + 1);
      last = r;
      if (r.sent === 0) break;
    }
    expect(w.mails.length).toBe(90);
    expect(new Set(w.mails).size).toBe(90);
    expect(calls).toBe(4); // 40 + 40 + 10, then nothing left to send
    for (const id of noAddress) expect(reported.has("Player " + id.slice(1))).toBe(true);
    expect(last.remaining).toBe(0);
  });

  it("the first call stops after its batch and says how many were not reached", async () => {
    const all = Array.from({ length: 95 }, (_, i) => ({ id: "p" + i, name: "Player " + i }));
    const w = world();
    const r = await sendGraduationHistories(all, w.deps, { limit: 40 });
    expect(r.sent).toBe(40);
    expect(r.remaining).toBe(55);
  });

  it("if stamping the send fails once it is tried again, and a second failure is logged, not hidden", async () => {
    let tries = 0;
    const w = world({ markSent: async () => { tries++; if (tries === 1) throw new Error("db"); } });
    await sendGraduationHistories(people.slice(0, 1), w.deps);
    expect(tries).toBe(2);
    const spy = [] as unknown[][];
    const orig = console.error;
    console.error = (...a: unknown[]) => void spy.push(a);
    try {
      const w2 = world({ markSent: async () => { throw new Error("db"); } });
      const r = await sendGraduationHistories(people.slice(0, 1), w2.deps);
      expect(r.sent).toBe(1);
      expect(spy.length).toBe(1);
    } finally {
      console.error = orig;
    }
  });

  it("an unreadable claim is reported, and nothing is sent without one", async () => {
    const w = world({ claim: async () => "error" });
    const r = await sendGraduationHistories(people.slice(0, 1), w.deps);
    expect(r.problems).toEqual([{ name: "Ann", why: WHY.recordFailed }]);
    expect(w.mails.length).toBe(0);
  });

  it("something that throws mid-send releases the claim and is reported", async () => {
    const w = world({ send: async () => { throw new Error("boom"); } });
    const r = await sendGraduationHistories(people.slice(0, 1), w.deps);
    expect(r.problems).toEqual([{ name: "Ann", why: WHY.sendFailed }]);
    expect(w.claims.has("a")).toBe(false);
  });
});
