import { describe, expect, it } from "vitest";
import { FAITH_PACK, READ_PACKS, findByRef, hashString, pickDailyItem, viewerOrder, type ReadPack } from "@/lib/read-content";

const tiny: ReadPack = {
  id: "t",
  title: "T",
  items: [
    { ref: "Psalm 23:1", text: "The LORD is my shepherd; I shall not want." },
    { ref: "Psalm 46:1", text: "God is our refuge and strength, a very present help in trouble." },
    { ref: "John 3:16", text: "For God so loved the world." },
  ],
};

describe("hashString", () => {
  it("is the stable FNV-1a hash, the same on every device", () => {
    expect(hashString("")).toBe(2166136261);
    expect(hashString("a")).toBe(3826002220);
  });
});

describe("findByRef", () => {
  it("finds a reading ignoring case and extra spaces", () => {
    expect(findByRef(tiny, "  psalm   23:1 ")?.ref).toBe("Psalm 23:1");
  });
  it("returns null for nothing or an unknown reference", () => {
    expect(findByRef(tiny, null)).toBeNull();
    expect(findByRef(tiny, "")).toBeNull();
    expect(findByRef(tiny, "Psalm 99:9")).toBeNull();
  });
});

describe("pickDailyItem", () => {
  it("gives one person the same reading all day", () => {
    const a = pickDailyItem(tiny, "2026-11-03", "viewer-1");
    const b = pickDailyItem(tiny, "2026-11-03", "viewer-1");
    expect(a).toEqual(b);
  });

  it("gives different clients different readings on the same day", () => {
    const refs = new Set<string>();
    for (let i = 0; i < 40; i++) refs.add(pickDailyItem(FAITH_PACK, "2026-11-03", `client-${i}`)!.ref);
    expect(refs.size).toBeGreaterThan(10);
  });

  it("changes from one day to the next for the same person", () => {
    const refs = new Set<string>();
    for (let d = 1; d <= 28; d++) refs.add(pickDailyItem(FAITH_PACK, `2026-11-${String(d).padStart(2, "0")}`, "client-1")!.ref);
    expect(refs.size).toBeGreaterThan(10);
  });

  it("goes through a cycle (Oct 21): over any run of N days each person sees all N readings once, nobody repeats one until they have seen them all", () => {
    const n = FAITH_PACK.items.length;
    for (const viewer of ["client-1", "client-2"]) {
      for (const startDay of [0, 137]) {
        const seen = new Set<string>();
        const start = Date.UTC(2026, 10, 3) + startDay * 86400000;
        for (let i = 0; i < n; i++) seen.add(pickDailyItem(FAITH_PACK, new Date(start + i * 86400000).toISOString().slice(0, 10), viewer)!.ref);
        expect(seen.size, `${viewer} from day ${startDay}`).toBe(n);
      }
    }
    // the tiny pack: three days, three different readings, then the same three again in the same order
    const days = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map((d) => pickDailyItem(tiny, d, "viewer-1")!.ref);
    expect(new Set(days.slice(0, 3)).size).toBe(3);
    expect(days.slice(3)).toEqual(days.slice(0, 3));
  });

  it("each person has their own order: the same person and day always give the same reading, and orders differ between people", () => {
    expect(viewerOrder(10, "a")).toEqual(viewerOrder(10, "a"));
    expect([...viewerOrder(10, "a")].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(viewerOrder(50, "a")).not.toEqual(viewerOrder(50, "b"));
    expect(pickDailyItem(FAITH_PACK, "2030-02-14", "client-9")).toEqual(pickDailyItem(FAITH_PACK, "2030-02-14", "client-9"));
    // days before the cycle's start still work
    expect(pickDailyItem(FAITH_PACK, "2025-06-01", "client-9")).not.toBeNull();
  });

  it("uses the coach's choice for the day when it is a bundled reading", () => {
    expect(pickDailyItem(tiny, "2026-11-03", "viewer-1", "john 3:16")?.ref).toBe("John 3:16");
  });

  it("ignores a coach's choice that is not bundled and picks as usual", () => {
    const withBad = pickDailyItem(tiny, "2026-11-03", "viewer-1", "Obadiah 1:1");
    expect(withBad).toEqual(pickDailyItem(tiny, "2026-11-03", "viewer-1"));
  });

  it("offers nothing from an empty pack", () => {
    expect(pickDailyItem({ id: "e", title: "E", items: [] }, "2026-11-03", "viewer-1")).toBeNull();
  });
});

describe("READ_PACKS", () => {
  it("holds the Faith pack", () => {
    expect(READ_PACKS.map((p) => p.id)).toEqual(["faith"]);
    expect(FAITH_PACK.items.length).toBeGreaterThanOrEqual(365);
  });
});
