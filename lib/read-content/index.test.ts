import { describe, expect, it } from "vitest";
import { FAITH_PACK, READ_PACKS, findByRef, hashString, pickDailyItem, type ReadPack } from "@/lib/read-content";

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
