import { describe, expect, it } from "vitest";
import { getReadForViewer } from "@/lib/read-content/for-viewer";
import { FAITH_PACK, pickDailyItem } from "@/lib/read-content";

function clientReturning(result: { data: unknown; error: unknown } | "throw") {
  return {
    rpc: async () => {
      if (result === "throw") throw new Error("network");
      return result;
    },
  } as never;
}

describe("getReadForViewer", () => {
  it("offers today's passage when Read is on", async () => {
    const out = await getReadForViewer(clientReturning({ data: { enabled: true, override_reference: null, note_seen: false }, error: null }), "g1", "v1", "2026-11-03");
    const expected = pickDailyItem(FAITH_PACK, "2026-11-03", "v1")!;
    expect(out).toEqual({ ref: expected.ref, text: expected.text, noteSeen: false });
  });

  it("uses the coach's passage for the day", async () => {
    const out = await getReadForViewer(clientReturning({ data: { enabled: true, override_reference: FAITH_PACK.items[7].ref, note_seen: true }, error: null }), "g1", "v1", "2026-11-03");
    expect(out?.ref).toBe(FAITH_PACK.items[7].ref);
    expect(out?.noteSeen).toBe(true);
  });

  it("offers nothing when Read is off for this person", async () => {
    const out = await getReadForViewer(clientReturning({ data: { enabled: false, override_reference: null, note_seen: true }, error: null }), "g1", "v1", "2026-11-03");
    expect(out).toBeNull();
  });

  it("never blocks a workout: an error or a failed call offers nothing", async () => {
    expect(await getReadForViewer(clientReturning({ data: null, error: { message: "boom" } }), "g1", "v1", "2026-11-03")).toBeNull();
    expect(await getReadForViewer(clientReturning("throw"), "g1", "v1", "2026-11-03")).toBeNull();
  });
});
