import { describe, it, expect } from "vitest";
import { countPhrase } from "@/lib/number-words";
import { REFERENCE_OBJECTS, getVolumeEquivalence } from "@/lib/volume-equivalence";
import { DISTANCE_UNITS, distanceCandidates, getDistanceEquivalence } from "@/lib/distance-equivalence";
import { funLinePool, pickFreshFunLine, MAX_FUN_LINE_CHARS, type WorkoutFacts } from "@/lib/workout-fun-line";

describe("counts in words", () => {
  it("small counts are digits, big ones are rounded and in words", () => {
    expect(countPhrase(2)).toBe("2");
    expect(countPhrase(38.4)).toBe("38");
    expect(countPhrase(999)).toBe("999");
    expect(countPhrase(1234)).toBe("about 1,200");
    expect(countPhrase(283600)).toBe("about 280 thousand");
    expect(countPhrase(1_800_000)).toBe("about 1.8 million");
    expect(countPhrase(4_840_000)).toBe("about 4.8 million");
  });
  it("close to one is 'about one'; between 1.15 and 2 it is 2, never 'about one' for nearly double; never a fraction or a zero", () => {
    expect(countPhrase(1.1)).toBe("about one");
    expect(countPhrase(1.9)).toBe("2");
    expect(countPhrase(1.5)).toBe("2");
    expect(countPhrase(0.2)).toBe("about one");
    expect(countPhrase(0)).toBe("about one");
    expect(countPhrase(Number.NaN)).toBe("about one");
  });
});

describe("the weight units", () => {
  it("every unit has a source and a real weight, and the corrected weights are in", () => {
    for (const u of REFERENCE_OBJECTS) {
      expect(u.source.length, u.name).toBeGreaterThan(8);
      expect(u.weightLbs, u.name).toBeGreaterThan(0);
      expect(u.pluralName.length, u.name).toBeGreaterThan(2);
    }
    const w = (name: string) => REFERENCE_OBJECTS.find((u) => u.name === name)?.weightLbs;
    expect(w("a vending machine")).toBe(700);
    expect(w("a school bus")).toBe(25000);
    expect(w("a blue whale")).toBe(200000);
    expect(w("a keg of beer")).toBe(58);
    expect(w("a bull elephant")).toBe(12000);
    expect(REFERENCE_OBJECTS.some((u) => u.name === "a baby elephant")).toBe(false);
    for (const name of ["a jellybean", "a newborn kangaroo joey", "a pet hamster", "a Statue of Liberty", "a grizzly bear"]) expect(w(name), name).toBeGreaterThan(0);
  });
  it("small volumes can be jellybeans, and the line says it in words", () => {
    const texts = new Set<string>();
    for (let i = 0; i < 200; i++) texts.add(getVolumeEquivalence(12000, `s${i}`)!.label);
    expect([...texts].some((t) => /million|thousand/.test(t))).toBe(true);
    expect([...texts].some((t) => /^\d+ /.test(t))).toBe(true);
  });
  it("1.9 Statues of Liberty is never called about one", () => {
    for (let i = 0; i < 100; i++) {
      const eq = getVolumeEquivalence(450000 * 1.9, `s${i}`)!;
      expect(eq.label, eq.label).not.toBe("about one Statue of Liberty");
    }
  });
  it("a volume close to one Statue of Liberty reads 'about one'", () => {
    const labels = new Set(Array.from({ length: 100 }, (_, i) => getVolumeEquivalence(450000, `s${i}`)!.label));
    expect([...labels].some((l) => l === "about one Statue of Liberty")).toBe(true);
  });
});

describe("if those pounds were miles", () => {
  it("every distance has a source note", () => {
    for (const d of DISTANCE_UNITS) expect(d.source.length, d.key).toBeGreaterThan(10);
    expect(DISTANCE_UNITS.find((d) => d.key === "marathon")?.miles).toBe(26.2);
    expect(DISTANCE_UNITS.find((d) => d.key === "around-earth")?.miles).toBe(24901);
    expect(DISTANCE_UNITS.find((d) => d.key === "vegas-birmingham")?.miles).toBe(1820);
  });
  it("makes whole counts from 2 to 999, 'once' near one, 'halfway' around the Earth", () => {
    expect(distanceCandidates(26.2 * 46).find((c) => c.id === "miles:marathon")?.text).toContain("run 46 marathons");
    expect(getDistanceEquivalence(26.2 * 46, "x")).not.toBeNull();
    expect(distanceCandidates(12450).find((c) => c.id === "miles:around-earth")?.text).toContain("halfway around the Earth");
    expect(distanceCandidates(24901).find((c) => c.id === "miles:around-earth")?.text).toContain("all the way around the Earth");
    expect(distanceCandidates(477800).find((c) => c.id === "miles:moon-and-back")?.text).toContain("Moon and back");
  });
  it("never a fraction, never nothing: no line when nothing fits", () => {
    expect(distanceCandidates(3)).toEqual([]);
    expect(distanceCandidates(0)).toEqual([]);
    expect(distanceCandidates(-5)).toEqual([]);
    for (const pounds of [30, 500, 5000, 12345, 90000, 480000]) for (const c of distanceCandidates(pounds)) expect(c.text, c.text).not.toMatch(/(^|\s)0\.|NaN|undefined/);
  });
});

const facts: WorkoutFacts = { totalVolume: 12450, durationSeconds: 3600, totalSets: 20, weekStreak: 0, prCount: 0, totalWorkoutCount: 5 };

describe("the mix on the card", () => {
  it("about one in six of the volume comparisons is a miles line", () => {
    const equiv = funLinePool(facts).filter((l) => l.kind === "equiv");
    const miles = equiv.filter((l) => l.id.startsWith("miles:"));
    expect(miles.length).toBeGreaterThanOrEqual(1);
    expect(miles.length).toBeLessThanOrEqual(2);
    expect(equiv.length).toBeGreaterThanOrEqual(8);
    expect(equiv.length / miles.length).toBeGreaterThanOrEqual(5);
  });
  it("every line fits the card and the same unit never shows twice in a row", () => {
    for (const l of funLinePool(facts)) expect(l.text.length, l.text).toBeLessThanOrEqual(MAX_FUN_LINE_CHARS);
    const recent: { id: string; kind: "stat" | "equiv" | "absurd" | "encourage" }[] = [];
    let prev = "";
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 60; i++) {
      const line = pickFreshFunLine(facts, recent, rand);
      expect(line.id).not.toBe(prev);
      prev = line.id;
      recent.push({ id: line.id, kind: line.kind });
    }
  });
  it("no comparison line leaves a number half-written", () => {
    for (const volume of [1000, 2500, 12450, 80000, 499999]) {
      for (const l of funLinePool({ ...facts, totalVolume: volume })) {
        if (l.kind === "equiv") expect(l.text, l.text).not.toMatch(/NaN|undefined|(^|\s)0\.\d/);
      }
    }
  });
});
