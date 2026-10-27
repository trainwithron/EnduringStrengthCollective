import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_NOT_FINISHED, STILL_IMPORTING, assignProgramToClient, duplicateProgram, importRefusalFor, isImportRefusal } from "./program-duplication";
import { spendFreeUseThenCredits } from "./ai-week-edit";
import { filterAssignableWorkouts } from "./assignable-workouts";
import { loadAssignedGroups } from "./org-programs";
import { startOnce } from "@/components/coach/create-and-open-program";

// Commander's audit of the Oct 26 releases (organization programs, Make a template). Sawyer Steele's copy of an imported organization program was made while the import was
// still being written, so it had 29 of its 49 days (repaired by step 188).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A database that answers one programs read (importing, created_at) and records the copy calls.
function db(program: { importing: boolean; created_at: string } | null) {
  const rpc = vi.fn(async (name: string) => (name === "duplicate_program" ? { data: "copy-1", error: null } : { data: null, error: null }));
  const rpcChain = (name: string) => ({ single: async () => ({ data: { assigned_program_id: "copy-2", was_attached: false }, error: null }), then: (f: (v: unknown) => unknown) => rpc(name).then(f) });
  return {
    rpc,
    client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: program, error: null }) }) }) }),
      rpc: (name: string) => (name === "assign_program_to_client" ? (rpc(name), rpcChain(name)) : rpc(name)),
    },
  };
}

describe("1. an import is never copied while it is being written", () => {
  const now = Date.parse("2026-10-26T21:44:34Z");
  it("still being written: 'Still importing. Try again in a moment.'; long after it started: it did not finish; a finished one copies", () => {
    expect(importRefusalFor({ importing: true, created_at: "2026-10-26T21:44:04Z" }, now)).toBe(STILL_IMPORTING);
    expect(STILL_IMPORTING).toBe("Still importing. Try again in a moment.");
    expect(importRefusalFor({ importing: true, created_at: "2026-10-26T21:00:00Z" }, now)).toBe(IMPORT_NOT_FINISHED);
    expect(importRefusalFor({ importing: false, created_at: "2026-10-26T21:44:04Z" }, now)).toBeNull();
    expect(importRefusalFor(null, now)).toBeNull();
    expect(isImportRefusal(STILL_IMPORTING) && isImportRefusal(IMPORT_NOT_FINISHED) && !isImportRefusal("Couldn't assign the program.")).toBe(true);
  });
  it("Duplicate (and Make a template, and Assign to a group, which copy through it) and Assign to a client refuse it before anything is copied", async () => {
    const half = db({ importing: true, created_at: new Date().toISOString() });
    expect(await duplicateProgram(half.client as never, { sourceProgramId: "p", destinationGroupId: "g", createdBy: "c" })).toEqual({ error: STILL_IMPORTING });
    expect(await assignProgramToClient(half.client as never, { sourceProgramId: "p", destinationGroupId: "g", athleteId: "a" })).toEqual({ error: STILL_IMPORTING });
    expect(half.rpc).not.toHaveBeenCalled();
    const done = db({ importing: false, created_at: new Date().toISOString() });
    expect(await duplicateProgram(done.client as never, { sourceProgramId: "p", destinationGroupId: "g", createdBy: "c" })).toEqual({ programId: "copy-1" });
    expect(await assignProgramToClient(done.client as never, { sourceProgramId: "p", destinationGroupId: "g", athleteId: "a" })).toEqual({ programId: "copy-2", attached: false });
  });
  it("the import is written switched off and marked, and switched on (unless it is an AI draft) only after the last day", () => {
    // the writing moved to lib/write-imported-program.ts (Oct 27: an import fills the program it was started in)
    const w = read("lib/write-imported-program.ts");
    expect(w).toContain("    is_active: false,\n    importing: true,");
    expect(w).not.toContain("is_active: !input.isAiSourced,\n    ai_draft");
    const finish = w.indexOf('update({ importing: false, is_active: !input.isAiSourced })');
    expect(finish).toBeGreaterThan(w.indexOf('from("group_workout_exercise_sets").insert(setsPayload)'));
    expect(w).toContain("The program was written but did not finish saving, so it can't be assigned yet. Import it again.");
  });
  it("every screen that copies shows the refusal as it is (not 'Couldn't ...')", () => {
    expect(read("components/coach/assign-to-client-banner.tsx")).toContain('setError(isImportRefusal(result.error) ? result.error : "Couldn\'t assign it. Try again.");');
    expect(read("components/coach/desktop/use-template-panel.tsx")).toContain("setError(isImportRefusal(why) ? (why as string) : MAKE_FAILED_MESSAGE);");
    const mt = read("lib/make-template.ts");
    expect(mt).toContain("const refused = await importRefusal(supabase, programId);\n  if (refused) return { error: refused };");
    expect(mt).toContain('return { error: isImportRefusal(copy.error) ? copy.error : "Couldn\'t make the template. Try again." };');
  });
});

describe("2. a client never sees an organization program's workouts", () => {
  it("the workouts offered to put on a client's day leave organization programs out", () => {
    const row = (id: string, org: boolean) => ({ id, title: "Day 1", week_number: 1, day_index: 0, programs: { name: id, ai_draft: false, archived_at: null, athlete_id: null, org_program: org } });
    expect(filterAssignableWorkouts([row("group", false), row("org", true)], "a", false).map((w) => w.id)).toEqual(["group"]);
    expect(read("lib/assignable-workouts.ts")).toContain("programs ( name, ai_draft, archived_at, athlete_id, org_program )");
  });
});

describe("3. 'this group's program' reads leave organization programs out", () => {
  it.each([
    ["lib/dashboard-data.ts", '.eq("is_active", true).eq("org_program", false).order("id")'],
    ["lib/needs-attention-data.ts", '.eq("group_id", groupId).eq("is_active", true).eq("org_program", false);'],
    ["lib/coach-briefing-gather.ts", '.eq("is_active", true).eq("org_program", false).order("id")'],
    ["app/(coach)/groups/[groupId]/challenges/page.tsx", '.is("athlete_id", null)\n        .eq("org_program", false)\n        .order("name"),'],
    ["app/(coach)/groups/[groupId]/programs/page.tsx", '.is("archived_at", null)\n    // The organization\'s own programs are in the program library, not this group\'s Programs (0435).\n    .eq("org_program", false)'],
    ["lib/spotter-tier1-sync.ts", '.eq("is_active", true).eq("org_program", false).order("id")'],
    ["app/api/assistant/navigate/route.ts", '.eq("is_active", true).eq("org_program", false).order("id")'],
    ["lib/my-training.ts", '.is("archived_at", null)\n        .eq("org_program", false)'],
  ])("%s", (file, text) => {
    expect(read(file)).toContain(text);
  });
});

describe("4. a library Duplicate or a template of the program is not a group's copy", () => {
  it("loadAssignedGroups reads only copies that are not organization programs", async () => {
    const calls: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) chain[m] = (...a: unknown[]) => (calls.push(`${m}:${a.join(",")}`), chain);
    (chain as { then: unknown }).then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "c", group_id: "team", groups: { name: "Team" } }], error: null }).then(f);
    const rows = await loadAssignedGroups({ from: () => chain } as never, "p");
    expect(rows).toEqual([{ programId: "c", groupId: "team", groupName: "Team" }]);
    expect(calls).toContain("eq:org_program,false");
    expect(calls).toContain("eq:source_program_id,p");
  });
});

describe("5. changing later weeks: a free use is given back when the credits cannot be spent", () => {
  it("free use taken, spend fails: given back, and the failure is returned", async () => {
    const giveBack = vi.fn(async () => {});
    const r = await spendFreeUseThenCredits({ takeFree: async () => ({ ok: true, free: true, useId: "u1" }), spendCredits: async () => ({ ok: false, error: "Out of credits." }), giveBack });
    expect(r).toEqual({ ok: false, error: "Out of credits." });
    expect(giveBack).toHaveBeenCalledWith("u1");
  });
  it("spent: nothing given back; not on the free tier: nothing to give back; no free use left: no spend", async () => {
    const giveBack = vi.fn(async () => {});
    expect(await spendFreeUseThenCredits({ takeFree: async () => ({ ok: true, free: true, useId: "u1" }), spendCredits: async () => ({ ok: true }), giveBack })).toEqual({ ok: true });
    await spendFreeUseThenCredits({ takeFree: async () => ({ ok: true, free: false }), spendCredits: async () => ({ ok: false }), giveBack });
    expect(giveBack).not.toHaveBeenCalled();
    const spendCredits = vi.fn(async () => ({ ok: true }));
    expect(await spendFreeUseThenCredits({ takeFree: async () => ({ ok: false, error: "No free uses left." }), spendCredits, giveBack })).toEqual({ ok: false, error: "No free uses left." });
    expect(spendCredits).not.toHaveBeenCalled();
  });
  it("the route charges through it, and the free use's id comes back from takeFreeTierUse", () => {
    expect(read("app/api/ai/edit-weeks/route.ts")).toContain("giveBack: (useId) => giveBackFreeTierUse(createServiceRoleClient(), useId),");
    expect(read("lib/free-tier-server.ts")).toContain("return { ok: true, free: true, used: place + 1, useId: inserted.id };");
  });
});

describe("the two empty \"Sawyer's program\" made 5 ms apart", () => {
  it("New program opened twice in a row makes ONE program: the second opens the first's", async () => {
    let made = 0;
    const make = async () => `p${++made}`;
    const [a, b] = await Promise.all([startOnce("k1", make, 1000), startOnce("k1", make, 1005)]);
    expect([a, b, made]).toEqual(["p1", "p1", 1]);
    // a later, deliberate New program makes a new one; a failed start can be tried again at once
    expect(await startOnce("k1", make, 7000)).toBe("p2");
    expect(await startOnce("k2", async () => null, 8000)).toBeNull();
    expect(await startOnce("k2", make, 8001)).toBe("p3");
  });
  it("a page in a pane stays a pane page after a refresh (it was drawn whole, then swapped, mounting it twice)", () => {
    const e = read("components/shared/embedded-context.tsx");
    expect(e).toContain('if (fromServer && typeof window !== "undefined") framedHere = true;');
    expect(e).toContain('useState(() => typeof window !== "undefined" && framedHere)');
  });
});
