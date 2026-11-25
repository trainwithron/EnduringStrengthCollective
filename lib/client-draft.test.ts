import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftAddress, findClientDraft, startNewAddress } from "@/lib/client-draft";

// Build program reopens the client's draft (reports/spotter-builder-crosscheck-ORDER.md, Part 3, Nov 24; step 229 / 0473).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

type Filter = [op: string, col: string, val: unknown];
// A stand-in for the two reads: the drafts query (its filters are recorded) and the copies query.
function fake(drafts: { data: { id: string }[] | null; error?: unknown }, copies: { data: { source_program_id: string }[] | null; error?: unknown }) {
  const seen: Filter[] = [];
  let call = 0;
  const builder = (result: unknown) => {
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => (seen.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (seen.push(["is", c, v]), b),
      in: (c: string, v: unknown) => (seen.push(["in", c, v]), Promise.resolve(result)),
      order: (c: string, o: unknown) => (seen.push(["order", c, o]), b),
      limit: () => Promise.resolve(result),
    };
    return b;
  };
  const supabase: any = { from: () => builder(call++ === 0 ? { data: drafts.data, error: drafts.error ?? null } : { data: copies.data, error: copies.error ?? null }) };
  return { supabase, seen };
}
const input = { coachId: "coach", groupId: "team", clientId: "robyn" };

describe("the client's draft", () => {
  it("is this coach's, in this group, started for this client, nobody's, not hidden, not switched on: newest first", async () => {
    const { supabase, seen } = fake({ data: [{ id: "new" }, { id: "old" }] }, { data: [] });
    expect(await findClientDraft(supabase, input)).toBe("new");
    expect(seen).toEqual(
      expect.arrayContaining([
        ["eq", "created_by", "coach"],
        ["eq", "group_id", "team"],
        ["eq", "for_client_id", "robyn"],
        ["is", "athlete_id", null],
        ["is", "archived_at", null],
        ["eq", "is_active", false],
        ["order", "created_at", { ascending: false }],
      ])
    );
  });
  it("one already assigned (a client copy was made from it) is skipped for the next", async () => {
    const { supabase } = fake({ data: [{ id: "new" }, { id: "old" }] }, { data: [{ source_program_id: "new" }] });
    expect(await findClientDraft(supabase, input)).toBe("old");
  });
  it("none, all assigned, or a failed read (before the paste the column is not there): a new program is made", async () => {
    expect(await findClientDraft(fake({ data: [] }, { data: [] }).supabase, input)).toBeNull();
    expect(await findClientDraft(fake({ data: [{ id: "a" }] }, { data: [{ source_program_id: "a" }] }).supabase, input)).toBeNull();
    expect(await findClientDraft(fake({ data: null, error: { message: "column programs.for_client_id does not exist" } }, { data: [] }).supabase, input)).toBeNull();
    expect(await findClientDraft(fake({ data: [{ id: "a" }] }, { data: null, error: { message: "x" } }).supabase, input)).toBeNull();
  });
  it("addresses: the builder (marked when reopened) and Start a new one instead", () => {
    const fc = { id: "robyn", groupId: "robyn-space" };
    expect(draftAddress("team", "p1", fc, true)).toBe("/groups/team/programs/p1?edit=1&forClient=robyn&clientGroup=robyn-space&reopened=1");
    expect(draftAddress("team", "p1", fc, false)).toBe("/groups/team/programs/p1?edit=1&forClient=robyn&clientGroup=robyn-space");
    expect(startNewAddress(fc)).toBe("/groups/robyn-space/programs/new?athleteId=robyn&fresh=1");
  });
});

describe("Build program uses it", () => {
  const page = read("app/(coach)/groups/[groupId]/programs/new/page.tsx");
  const make = read("components/coach/create-and-open-program.tsx");
  const banner = read("components/coach/assign-to-client-banner.tsx");
  it("opens the draft instead of making one, unless Start a new one instead asked", () => {
    expect(page).toContain('if (forClient && searchParams.fresh !== "1") {');
    expect(page).toContain("const draftId = await findClientDraft(supabase, { coachId: user.id, groupId: targetGroupId, clientId: forClient.id });");
    expect(page).toContain("if (draftId) redirect(draftAddress(targetGroupId, draftId, forClient, true));");
    expect(page.indexOf("findClientDraft(")).toBeLessThan(page.indexOf("<CreateAndOpenProgram"));
  });
  it("a new draft for a client says which client, still once per tap (startOnce), and works before the paste", () => {
    expect(make).toContain("forClient ? { ...row, for_client_id: forClient.id } : row");
    expect(make).toContain('/for_client_id/.test(insertError.message ?? "")');
    expect(make).toContain("const id = await startOnce(");
  });
  it("the builder offers Start a new one instead on a reopened draft", () => {
    expect(banner).toContain("{reopened && (");
    expect(banner).toContain("startNewAddress({ id: clientId, groupId: clientGroupId })");
    expect(banner).toContain("Start a new one instead");
    expect(banner).toContain("prefetch={false}");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain('reopened={searchParams.reopened === "1"}');
  });
  it("step 229 is in the plan and the rehearsal", () => {
    expect(read("scripts/sql-tests/harness.mjs")).toContain('"0472", "0473",');
    expect(read("supabase/REHEARSAL.md")).toContain("| 0473 | yes | applies only | 0 | - |");
    const mig = read("supabase/migrations/0473_program_for_client.sql");
    expect(mig).toContain("add column if not exists for_client_id uuid references public.profiles(id) on delete set null;");
    expect(mig).toContain("create index if not exists programs_for_client_draft_idx");
    expect(read("supabase/apply/apply-step229-0473.sql")).toContain(mig.trimEnd());
  });
});
