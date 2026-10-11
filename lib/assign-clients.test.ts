import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAssignableClients, pickDestination } from "@/lib/assign-clients";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("where a client's copy goes", () => {
  it("their one-on-one space when they have one", () => {
    expect(pickDestination([{ groupId: "team", kind: "team" }, { groupId: "solo", kind: "one_on_one" }], "team")).toBe("solo");
  });
  it("otherwise the program's own group if they are in it, otherwise the first group of theirs", () => {
    expect(pickDestination([{ groupId: "a", kind: "team" }, { groupId: "b", kind: "social" }], "b")).toBe("b");
    expect(pickDestination([{ groupId: "a", kind: "team" }, { groupId: "b", kind: "social" }], "z")).toBe("a");
  });
  it("a person in no group the coach coaches has nowhere to go", () => {
    expect(pickDestination([], "a")).toBeNull();
  });
});

// A fake database: the coach coaches group A (where the program is, William's one-on-one space) and group B (Max's one-on-one space) and a team T.
function fakeSupabase() {
  const memberships = [
    { profile_id: "will", group_id: "A", profiles: { full_name: "William Stafford" } },
    { profile_id: "max", group_id: "B", profiles: { full_name: "Max Anthony" } },
    { profile_id: "ann", group_id: "T", profiles: { full_name: "Ann Lee" } },
    { profile_id: "ann", group_id: "A2", profiles: { full_name: "Ann Lee" } },
  ];
  const coached = [
    { group_id: "A", groups: { id: "A", name: "William Stafford", group_kind: "one_on_one", organization_id: "o", organizations: { name: "Org" } } },
    { group_id: "B", groups: { id: "B", name: "Max Anthony", group_kind: "one_on_one", organization_id: "o", organizations: { name: "Org" } } },
    { group_id: "T", groups: { id: "T", name: "Home Team", group_kind: "team", organization_id: "o", organizations: { name: "Org" } } },
    { group_id: "A2", groups: { id: "A2", name: "Ann Lee", group_kind: "one_on_one", organization_id: "o", organizations: { name: "Org" } } },
  ];
  return {
    from(table: string) {
      let usedIn = false;
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => {
          usedIn = true;
          return q;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: usedIn ? memberships : coached }),
      };
      void table;
      return q;
    },
  } as any;
}

describe("a program in one group, a client in another", () => {
  it("every client of the coach is listed, once each, in alphabetical order", async () => {
    const list = await loadAssignableClients(fakeSupabase(), "coach", "A");
    expect(list.map((c) => c.fullName)).toEqual(["Ann Lee", "Max Anthony", "William Stafford"]);
  });
  it("Max (only in group B) is listed and his copy lands in B, not in the program's group A", async () => {
    const list = await loadAssignableClients(fakeSupabase(), "coach", "A");
    const max = list.find((c) => c.id === "max")!;
    expect(max.destinationGroupId).toBe("B");
    expect(list.find((c) => c.id === "will")!.destinationGroupId).toBe("A");
  });
  it("a client in a team and in their own one-on-one space gets the copy in the one-on-one space, with no group hint", async () => {
    const list = await loadAssignableClients(fakeSupabase(), "coach", "T");
    const ann = list.find((c) => c.id === "ann")!;
    expect(ann.destinationGroupId).toBe("A2");
    expect(ann.hint).toBeNull();
  });
});

describe("the card menu uses it", () => {
  const menu = read("components/coach/desktop/program-card-menu.tsx");
  it("lists all the coach's clients, searchable, in the coach's own word, and copies into the client's own space", () => {
    expect(menu).toContain("loadAssignableClients(supabase, user.id, groupId)");
    expect(menu).toContain("<SearchPickList");
    expect(menu).toContain('term("client")');
    expect(menu).toContain("destinationGroupId: client.destinationGroupId,");
    expect(menu).toContain("/groups/${client.destinationGroupId}/programs/${result.programId}");
    expect(menu).toContain("/groups/${assigned.groupId}/programs/${assigned.programId}");
    expect(menu).not.toContain(".eq(\"group_id\", groupId)\n      .eq(\"role\", \"athlete\");\n    const options");
  });
  it("an unsigned AI draft is approved and assigned with ONE confirmation from the card, never silently", () => {
    expect(menu).not.toContain("disabled={aiDraft}");
    expect(menu).toContain("ensureApproved({ aiDraft, programId, programName, target: client.fullName })");
    expect(menu).toContain('ensureApproved({ aiDraft, programId, programName, target: "yourself" })');
    expect(menu).toContain("if (aiDraft && !(await signOffProgram(programId)))");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("aiDraft={program.aiDraft}");
  });
  it("adding has no confirmation popup on the single-client path", () => {
    const single = menu.slice(menu.indexOf("async function handleAssignToClient"), menu.indexOf("async function handleAssignToSelf"));
    expect(single).not.toContain("confirmDialog");
  });
  it("the client's profile uses the very same picker", () => {
    expect(read("components/coach/client-program-actions.tsx")).toContain("<SearchPickList");
  });
});
