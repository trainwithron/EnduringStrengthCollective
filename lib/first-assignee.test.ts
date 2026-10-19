import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultList } from "./programs-filter";
import { loadAssignedTo } from "./program-assigned";

// FIX 2 (Ron: "first person gets the original"): the program handed to its first person stays in the coach's list with "Assigned to", copies stay out of it, and old links still open it.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the Programs list", () => {
  const p = (id: string, athleteId: string | null, sourceProgramId: string | null) => ({ id, name: id, athleteId, athleteName: athleteId, sourceProgramId });
  it("shows the program its first person holds, not the copies of it", () => {
    const list = defaultList([p("orig", "amy", null), p("copy-bob", "bob", "orig"), p("lib", null, null)]);
    expect(list.map((x) => x.id)).toEqual(["orig", "lib"]);
  });
  it("keeps a copy whose source is not in the list (archived, or another organization's), so it is in some list", () => {
    const list = defaultList([p("orphan", "cal", "gone"), p("copy-bob", "bob", "lib"), p("lib", null, null)]);
    expect(list.map((x) => x.id)).toEqual(["orphan", "lib"]);
  });
  it("'Assigned to (n)' counts the copies plus the person holding the program itself, on every card that is not a copy", () => {
    const page = read("app/(coach)/programs/page.tsx");
    expect(page).toContain("for (const c of scoped) if (!c.sourceProgramId) c.assignedCount = (assignedCounts.get(c.id) ?? 0) + (c.athleteId ? 1 : 0);");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("{!program.sourceProgramId && <p");
  });
});

describe("who has it", () => {
  function fake(rows: unknown[]) {
    const seen: string[] = [];
    const builder: any = {
      select: () => builder,
      or: (f: string) => (seen.push(`or:${f}`), builder),
      eq: (c: string, v: string) => (seen.push(`eq:${c}=${v}`), builder),
      is: () => builder,
      not: () => builder,
      order: async () => ({ data: rows }),
    };
    return { client: { from: () => builder } as never, seen };
  }
  const row = (id: string, athlete: string, name: string) => ({ id, athlete_id: athlete, group_id: "g", start_date: null, profiles: { full_name: name } });
  it("with includeSelf the holder of the program itself is included and listed first", async () => {
    const f = fake([row("copy1", "bob", "Bob"), row("orig", "amy", "Amy")]);
    const people = await loadAssignedTo(f.client, "orig", { includeSelf: true });
    expect(f.seen).toEqual(["or:id.eq.orig,source_program_id.eq.orig"]);
    expect(people.map((x) => x.athleteName)).toEqual(["Amy", "Bob"]);
  });
  it("without it (the delete checks) only the copies count", async () => {
    const f = fake([row("copy1", "bob", "Bob")]);
    await loadAssignedTo(f.client, "orig");
    expect(f.seen).toEqual(["eq:source_program_id=orig"]);
  });
  it("the Assign panel and the program page include the holder; the delete checks do not", () => {
    expect(read("components/coach/desktop/program-assign-panel.tsx")).toContain("loadAssignedTo(createBrowserClient(), programId, { includeSelf: true })");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain("loadAssignedTo(supabase, programId, { includeSelf: true })");
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("(await loadAssignedTo(createBrowserClient(), programId)).length");
    expect(read("components/coach/desktop/programs-list.tsx")).toContain("(await loadAssignedTo(supabase, row.id)).length");
  });
});

describe("an old link to a program handed to its first person", () => {
  it("opens it in the group it moved to (keeping ?edit and ?week)", () => {
    const page = read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx");
    expect(page).toContain('const { data: moved } = await supabase.from("programs").select("group_id").eq("id", params.programId).maybeSingle();');
    expect(page).toContain("if (movedTo && movedTo !== params.groupId) {");
    expect(page.indexOf("if (movedTo && movedTo !== params.groupId)")).toBeLessThan(page.indexOf("if (!membership) {"));
  });
});
