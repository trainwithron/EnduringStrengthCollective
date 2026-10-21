import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAITH_PACK, pickDailyItem, withCoachPassages, type ReadPack } from "@/lib/read-content";
import { getReadForViewer } from "@/lib/read-content/for-viewer";
import { MAX_COACH_REFERENCE, MAX_COACH_TEXT } from "@/lib/read-content/limits";

// Ron, Oct 21: a coach types in his own verse and it joins the rotation.
const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8").replace(/\r\n/g, "\n");
const tiny: ReadPack = { id: "t", title: "T", items: [{ ref: "Psalm 23:1", text: "The LORD is my shepherd." }, { ref: "John 3:16", text: "For God so loved the world." }] };
const own = [{ ref: "Joshua 1:9", text: "Be strong and of a good courage." }];

describe("a coach's own passages join the cycle", () => {
  it("they come after the bundled ones; a reference already bundled is left out (its bundled text is used)", () => {
    expect(withCoachPassages(tiny, own).items.map((i) => i.ref)).toEqual(["Psalm 23:1", "John 3:16", "Joshua 1:9"]);
    expect(withCoachPassages(tiny, [{ ref: "psalm 23:1", text: "my own words" }]).items).toHaveLength(2);
    expect(withCoachPassages(tiny, [])).toBe(tiny);
  });
  it("each client sees every passage, his own included, once per cycle, with no repeats", () => {
    const pack = withCoachPassages(tiny, own);
    const three = ["2026-11-03", "2026-11-04", "2026-11-05"].map((d) => pickDailyItem(pack, d, "client-1")!.ref);
    expect(new Set(three)).toEqual(new Set(["Psalm 23:1", "John 3:16", "Joshua 1:9"]));
  });
  it("the coach can choose his own passage for a day", () => {
    expect(pickDailyItem(withCoachPassages(tiny, own), "2026-11-03", "client-1", "joshua 1:9")?.text).toBe("Be strong and of a good courage.");
  });
  it("the rest timer reads the passages of this group's coaches; a failed read is simply none", async () => {
    const db = (passages: { data: unknown; error: unknown }) =>
      ({
        rpc: async () => ({ data: { enabled: true, override_reference: "Coach word 1", note_seen: false }, error: null }),
        from: (table: string) => {
          const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain };
          chain.then = (res: (v: unknown) => void) => Promise.resolve(table === "group_memberships" ? { data: [{ profile_id: "coach" }], error: null } : passages).then(res);
          return chain;
        },
      }) as never;
    const out = await getReadForViewer(db({ data: [{ reference: "Coach word 1", text: "Be strong and of a good courage." }], error: null }), "g", "v", "2026-11-03");
    expect(out?.text).toBe("Be strong and of a good courage.");
    const failed = await getReadForViewer(db({ data: null, error: { message: "relation does not exist" } }), "g", "v", "2026-11-03");
    // his choice for the day is not a bundled passage and his own could not be read: the cycle picks as usual
    expect(failed?.ref).toBe(pickDailyItem(FAITH_PACK, "2026-11-03", "v")!.ref);
  });
});

describe("Settings > Read during rest > Your own passages", () => {
  const s = read("components/coach/read-during-rest-settings.tsx");
  it("adds and removes his own, within the database's limits, and offers them for a day too", () => {
    expect(MAX_COACH_REFERENCE).toBe(60);
    expect(MAX_COACH_TEXT).toBe(600);
    expect(read("supabase/migrations/0431_coach_read_passages.sql")).toContain("between 1 and 60");
    expect(read("supabase/migrations/0431_coach_read_passages.sql")).toContain("between 1 and 600");
    expect(s).toContain('.from("coach_read_passages").insert({ coach_id: coachId, reference, text })');
    expect(s).toContain('.from("coach_read_passages").delete().eq("id", row.id)');
    expect(s).toContain("{pickRefs.map((r) => (");
    expect(s).toContain("King James first.");
  });
  it("the screen never carries the bundled passage text (only the limits)", () => {
    expect(s).not.toMatch(/from "@\/lib\/read-content"/);
    expect(s).toContain('from "@/lib/read-content/limits"');
  });
  it("is hidden until the database step exists", () => {
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("ownPassages = ownRead.error ? null :");
    expect(s).toContain("{own !== null && (");
  });
});
