import { describe, expect, it } from "vitest";
import {
  ABSURD_LINES,
  ENCOURAGING_LINES,
  MAX_FUN_LINE_CHARS,
  RECENT_WINDOW,
  STAT_QUIPS,
  durationInWords,
  funLinePool,
  isSmallSession,
  pickFreshFunLine,
  pickSeededFunLine,
  rerollFunLine,
  type RecentLine,
  type WorkoutFacts,
} from "@/lib/workout-fun-line";
import { seededRandom } from "@/lib/seeded-pick";
import { memoryKey, readFunMemory, rememberLine, writeFunMemory, type StorageLike } from "@/lib/fun-line-memory";

const typical: WorkoutFacts = { totalVolume: 3821, durationSeconds: 66 * 60, totalSets: 20, weekStreak: 2, prCount: 0, totalWorkoutCount: 12 };

const EDGES: Record<string, WorkoutFacts> = {
  typical,
  "0 sets": { totalVolume: 0, durationSeconds: 30 * 60, totalSets: 0, weekStreak: 0, prCount: 0, totalWorkoutCount: 1 },
  "1 minute": { totalVolume: 5000, durationSeconds: 60, totalSets: 6, weekStreak: 0, prCount: 0, totalWorkoutCount: 3 },
  "100,000 lbs": { totalVolume: 100000, durationSeconds: 90 * 60, totalSets: 80, weekStreak: 5, prCount: 3, totalWorkoutCount: 40 },
  "all missing": { totalVolume: null, durationSeconds: null, totalSets: null, weekStreak: 0, prCount: 0, totalWorkoutCount: null },
  "tiny volume": { totalVolume: 12, durationSeconds: 5 * 60, totalSets: 1, weekStreak: 0, prCount: 0, totalWorkoutCount: 2 },
  "huge time": { totalVolume: 20000, durationSeconds: 5 * 3600 + 59 * 60, totalSets: 40, weekStreak: 0, prCount: 0, totalWorkoutCount: null },
  "bodyweight circuit": { totalVolume: 0, durationSeconds: 45 * 60, totalSets: 20, weekStreak: 0, prCount: 0, totalWorkoutCount: 6 },
  "60-minute run": { totalVolume: null, durationSeconds: 60 * 60, totalSets: 1, weekStreak: 3, prCount: 0, totalWorkoutCount: 20 },
  "typo volume": { totalVolume: 1_800_000, durationSeconds: 40 * 60, totalSets: 30, weekStreak: 0, prCount: 0, totalWorkoutCount: 8 },
  "timer left running": { totalVolume: 2000, durationSeconds: 4 * 3600, totalSets: 10, weekStreak: 0, prCount: 0, totalWorkoutCount: 5 },
  "PR only": { totalVolume: null, durationSeconds: null, totalSets: null, weekStreak: 0, prCount: 2, totalWorkoutCount: null },
};

const BAD = /NaN|undefined|Infinity|null|\[object|\$\{/;

describe("every line renders cleanly at edge values", () => {
  for (const [name, f] of Object.entries(EDGES)) {
    it(`${name}: a pick exists, reads cleanly, and fits the card`, () => {
      const pool = funLinePool(f);
      expect(pool.length).toBeGreaterThan(0);
      for (const l of pool) {
        expect(l.text, `${l.id}`).not.toMatch(BAD);
        expect(l.text.trim()).toBe(l.text);
        expect(l.text.length, l.id).toBeLessThanOrEqual(MAX_FUN_LINE_CHARS);
        expect(l.id.length).toBeGreaterThan(3);
      }
      expect(new Set(pool.map((l) => l.id)).size).toBe(pool.length); // ids are unique within a pool
      for (let i = 0; i < 25; i++) expect(pickSeededFunLine(f, `seed-${i}`).text).not.toMatch(BAD);
    });
  }

  it("leaves out volume lines for an impossible (typo) volume, and every other line still reads cleanly", () => {
    const pool = funLinePool(EDGES["typo volume"]);
    expect(pool.some((l) => l.kind === "equiv")).toBe(false);
    for (const l of pool) expect(l.text).not.toMatch(/1,800,000|pounds/i);
    expect(pool.length).toBeGreaterThan(5);
    // The cap is exact: 500,000 is still believable, one more is not.
    expect(funLinePool({ ...typical, totalVolume: 500_000, durationSeconds: null }).some((l) => l.kind === "equiv")).toBe(true);
    expect(funLinePool({ ...typical, totalVolume: 500_001, durationSeconds: null }).some((l) => l.kind === "equiv")).toBe(false);
  });

  it("never turns a timer left running into a rate or a time boast, and drops 'only' above 90 minutes", () => {
    const ids = funLinePool(EDGES["timer left running"]).map((l) => l.id);
    expect(ids).not.toContain("stat:money-rate");
    expect(ids).not.toContain("stat:per-minute");
    expect(ids).not.toContain("stat:time-and-pounds");
    const money = STAT_QUIPS.find((t) => t.key === "money-rate")!;
    const long = { ...typical, totalVolume: 9000, durationSeconds: 100 * 60 };
    expect(money.needs(long)).toBe(true);
    expect(money.text(long)).not.toContain(" only ");
    expect(money.text(typical)).toContain(" only ");
    // exactly 2 hours is the longest believable session
    expect(money.needs({ ...long, durationSeconds: 120 * 60 })).toBe(true);
    expect(money.needs({ ...long, durationSeconds: 120 * 60 + 60 })).toBe(false);
  });

  it("a slow rate is not worth saying (under 25 pounds a minute), a normal one is", () => {
    const perMinute = STAT_QUIPS.find((t) => t.key === "per-minute")!;
    expect(perMinute.needs({ ...typical, totalVolume: 2000, durationSeconds: 100 * 60 })).toBe(false); // 20 lb/min
    expect(perMinute.needs({ ...typical, totalVolume: 3000, durationSeconds: 100 * 60 })).toBe(true); // 30 lb/min
  });

  it("renders every stat template (with numbers that satisfy it) without a bad value", () => {
    const rich: WorkoutFacts = { totalVolume: 25000, durationSeconds: 75 * 60, totalSets: 24, weekStreak: 6, prCount: 2, totalWorkoutCount: 50 };
    for (const t of STAT_QUIPS) {
      expect(t.needs(rich), t.key).toBe(true);
      const text = t.text(rich);
      expect(text, t.key).not.toMatch(BAD);
      expect(text.length, t.key).toBeLessThanOrEqual(MAX_FUN_LINE_CHARS);
    }
  });

  it("Ron's example reads as asked", () => {
    const money = STAT_QUIPS.find((t) => t.key === "money-rate")!;
    expect(money.text(typical)).toBe("You lifted 3,821 pounds in only an hour and 6 minutes. Too bad we can't make money at that rate. 💸");
    expect(money.text(typical).length).toBeLessThanOrEqual(MAX_FUN_LINE_CHARS);
  });

  it("leaves a stat out when its number is missing or too small to mean anything", () => {
    const ids = (f: WorkoutFacts) => funLinePool(f).map((l) => l.id);
    expect(ids(EDGES["1 minute"])).not.toContain("stat:money-rate");
    expect(ids(EDGES["1 minute"])).not.toContain("stat:per-minute");
    expect(ids(EDGES["all missing"]).some((i) => i.startsWith("stat:"))).toBe(false);
    expect(ids(EDGES["PR only"])).toContain("stat:pr-retired");
  });

  it("says durations in words", () => {
    expect(durationInWords(60)).toBe("1 minute");
    expect(durationInWords(45 * 60)).toBe("45 minutes");
    expect(durationInWords(60 * 60)).toBe("an hour");
    expect(durationInWords(66 * 60)).toBe("an hour and 6 minutes");
    expect(durationInWords(121 * 60)).toBe("2 hours and 1 minute");
    expect(durationInWords(0)).toBe("1 minute");
  });
});

describe("kindness: a small, short or empty session is never joked about", () => {
  it("what counts as small", () => {
    expect(isSmallSession(EDGES["0 sets"])).toBe(true);
    expect(isSmallSession(EDGES["tiny volume"])).toBe(true);
    expect(isSmallSession({ ...typical, durationSeconds: 5 * 60 })).toBe(true);
    expect(isSmallSession({ ...typical, totalSets: 2, durationSeconds: 15 * 60 })).toBe(true);
    expect(isSmallSession({ ...typical, totalSets: 2, durationSeconds: null })).toBe(true);
    // A long session is not small whatever its pounds or set count: a 45-minute bodyweight circuit, a 60-minute run logged as one set.
    expect(isSmallSession({ ...typical, totalSets: 2 })).toBe(false);
    expect(isSmallSession(EDGES["bodyweight circuit"])).toBe(false);
    expect(isSmallSession(EDGES["60-minute run"])).toBe(false);
    expect(isSmallSession(typical)).toBe(false);
    expect(isSmallSession(EDGES["all missing"])).toBe(false);
  });
  it("a small session only ever gets an encouraging line or a streak/PR/count line: no joke, no comparison, no per-minute figure", () => {
    const kind = ["stat:streak-cheat-code", "stat:streak-calendar", "stat:pr-retired", "stat:pr-notified", "stat:workout-count"];
    for (const name of ["0 sets", "tiny volume"]) {
      for (const l of funLinePool(EDGES[name])) {
        expect(["encourage", "stat"]).toContain(l.kind);
        if (l.kind === "stat") expect(kind).toContain(l.id);
      }
    }
    for (let i = 0; i < 40; i++) {
      const l = pickSeededFunLine(EDGES["0 sets"], `s${i}`);
      expect(["encourage", "stat"]).toContain(l.kind);
    }
  });
  it("a bodyweight circuit or a long run gets a proper line, never 'a short session' or 'small sessions'", () => {
    for (const name of ["bodyweight circuit", "60-minute run"]) {
      const texts = funLinePool(EDGES[name]).map((l) => l.text);
      expect(texts.length).toBeGreaterThan(5);
      for (const t of texts) expect(t, name).not.toMatch(/short session|small sessions|checked in/i);
      expect(funLinePool(EDGES[name]).some((l) => l.kind === "encourage")).toBe(false);
      for (const l of funLinePool(EDGES[name])) expect(l.text).not.toMatch(/pounds/i);
    }
  });
  it("no line is written in the client's own voice or about a body, food, skipping, age, a coach or guilt", () => {
    for (const text of ABSURD_LINES) {
      expect(text, text).not.toMatch(/\b(I|I'm|I'd|I'll|I've|my|me|mine|myself)\b/);
      expect(text.toLowerCase(), text).not.toMatch(/skip|burrito|abs\b|mirror|coach|diet|shorts|excuse|bank account|sit down|assistance|calorie|belly|waist/);
    }
  });
  it("no line mentions the body, weight loss, fat, shame or failure", () => {
    const all = [...ABSURD_LINES, ...ENCOURAGING_LINES, ...funLinePool({ ...typical, prCount: 1 }).map((l) => l.text)];
    for (const text of all) expect(text.toLowerCase(), text).not.toMatch(/\bfat\b|ugly|lazy|failure|you failed|disappoint|pathetic|skinny|obese|diet of shame/);
  });
});

function simulate(f: WorkoutFacts, n: number, seed: string) {
  const rand = seededRandom(seed);
  const recent: RecentLine[] = [];
  const picks: { id: string; kind: string }[] = [];
  for (let i = 0; i < n; i++) {
    const line = pickFreshFunLine(f, recent, rand);
    picks.push({ id: line.id, kind: line.kind });
    recent.push({ id: line.id, kind: line.kind });
  }
  return picks;
}

describe("fresh, never repeating inside the window", () => {
  it("over many workouts no line repeats within the last 20", () => {
    const picks = simulate(typical, 80, "a");
    for (let i = 0; i < picks.length; i++) {
      const prior = picks.slice(Math.max(0, i - RECENT_WINDOW), i).map((p) => p.id);
      expect(prior, `pick ${i}`).not.toContain(picks[i].id);
    }
  });
  it("holds with a bigger workout that has many kinds available, and across different random runs", () => {
    for (const seed of ["x", "y", "z", "q"]) {
      const picks = simulate(EDGES["100,000 lbs"], 60, seed);
      for (let i = 0; i < picks.length; i++) {
        expect(picks.slice(Math.max(0, i - RECENT_WINDOW), i).map((p) => p.id)).not.toContain(picks[i].id);
      }
    }
  });
  it("spreads across the kinds", () => {
    const picks = simulate(typical, 90, "spread");
    const count = (k: string) => picks.filter((p) => p.kind === k).length;
    const counts = [count("stat"), count("equiv"), count("absurd")];
    for (const c of counts) expect(c).toBeGreaterThan(10);
    // No kind takes over: the biggest share is less than about twice the smallest.
    expect(Math.max(...counts)).toBeLessThan(Math.min(...counts) * 2.2);
  });
  it("the same workout facts do not always give the same line (it is fresh, not seeded by the workout)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(pickFreshFunLine(typical, [], seededRandom(`n${i}`)).id);
    expect(seen.size).toBeGreaterThan(8);
  });
  it("when everything has been seen (a small bank), it reuses the line seen longest ago, never crashes, and a recent line is not taken while another is free", () => {
    const f = EDGES["0 sets"];
    const pool = funLinePool(f);
    const recent: RecentLine[] = pool.map((l) => ({ id: l.id, kind: l.kind })); // all seen, in pool order
    const line = pickFreshFunLine(f, recent, seededRandom("all"));
    expect(line.id).toBe(pool[0].id); // the oldest
    const partial = recent.slice(0, pool.length - 1); // one never shown
    expect(pickFreshFunLine(f, partial, seededRandom("p")).id).toBe(pool[pool.length - 1].id);
  });
  it("is repeatable when seeded (the default a stranger sees)", () => {
    expect(pickSeededFunLine(typical, "post-1")).toEqual(pickSeededFunLine(typical, "post-1"));
  });
});

describe("Another one", () => {
  it("always returns a different line from the one showing, and still avoids the recent window", () => {
    const rand = seededRandom("shuffle");
    let current = pickFreshFunLine(typical, [], rand);
    const recent: RecentLine[] = [{ id: current.id, kind: current.kind }];
    for (let i = 0; i < 40; i++) {
      const next = rerollFunLine(typical, recent, current.id, rand);
      expect(next.id).not.toBe(current.id);
      expect(recent.slice(-RECENT_WINDOW).map((r) => r.id)).not.toContain(next.id);
      expect(next.text).not.toMatch(BAD);
      recent.push({ id: next.id, kind: next.kind });
      current = next;
    }
  });
  it("never returns the current line while another exists, even in a small pool", () => {
    const f = EDGES["0 sets"];
    const pool = funLinePool(f);
    expect(pool.length).toBeGreaterThan(1);
    const cur = pool[0];
    for (let i = 0; i < 20; i++) expect(rerollFunLine(f, [], cur.id, seededRandom(`r${i}`)).id).not.toBe(cur.id);
  });
});

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
}

describe("remembering lines on the device", () => {
  it("round-trips recent lines and the line for a card", () => {
    const s = fakeStorage();
    const line = pickSeededFunLine(typical, "p1");
    const mem0 = rememberLine(readFunMemory(s, "u1"), "post-1", line);
    writeFunMemory(s, "u1", mem0);
    const mem = readFunMemory(s, "u1");
    expect(mem.byPost["post-1"]).toEqual(line);
    expect(mem.recent).toEqual([{ id: line.id, kind: line.kind }]);
  });
  it("keeps each viewer's memory separate", () => {
    const s = fakeStorage();
    writeFunMemory(s, "a", rememberLine(readFunMemory(s, "a"), "p", pickSeededFunLine(typical, "1")));
    expect(readFunMemory(s, "b").recent).toEqual([]);
    expect(Object.keys(s.data)).toEqual([memoryKey("a")]);
  });
  it("a reroll replaces the card's line but both stay in recent", () => {
    const a = pickSeededFunLine(typical, "a");
    const b = rerollFunLine(typical, [{ id: a.id, kind: a.kind }], a.id, seededRandom("b"));
    let mem = rememberLine({ recent: [], byPost: {} }, "p", a);
    mem = rememberLine(mem, "p", b);
    expect(mem.byPost.p.id).toBe(b.id);
    expect(mem.recent.map((r) => r.id)).toEqual([a.id, b.id]);
  });
  it("is capped, and anything wrong in storage reads as empty", () => {
    let mem: ReturnType<typeof readFunMemory> = { recent: [], byPost: {} };
    for (let i = 0; i < 60; i++) mem = rememberLine(mem, `post-${i}`, { id: `absurd:${i}`, kind: "absurd", text: `line ${i}` });
    expect(mem.recent.length).toBe(40);
    expect(Object.keys(mem.byPost).length).toBe(30);
    expect(mem.byPost["post-59"]).toBeDefined();
    expect(mem.byPost["post-0"]).toBeUndefined();
    expect(readFunMemory(fakeStorage({ [memoryKey("u")]: "not json" }), "u")).toEqual({ recent: [], byPost: {} });
    expect(readFunMemory(fakeStorage({ [memoryKey("u")]: JSON.stringify({ recent: "x", byPost: 5 }) }), "u")).toEqual({ recent: [], byPost: {} });
    expect(readFunMemory(null, "u")).toEqual({ recent: [], byPost: {} });
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFunMemory(blocked, "u")).toEqual({ recent: [], byPost: {} });
    expect(() => writeFunMemory(blocked, "u", mem)).not.toThrow();
  });
});
