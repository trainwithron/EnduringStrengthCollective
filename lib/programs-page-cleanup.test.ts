import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyProgramsFilter, clientOptions, defaultList, firstName, newestFirst, typeOptions, type FilterableProgram } from "@/lib/programs-filter";

// Ron: the Programs page said "CLIENT PROGRAMS: No individually-assigned programs yet" while clients clearly had programs, and then "unnecessarily sorted ... just give me a list of my programs".
// ONE flat list (library programs and programs built for one client; a client's copy of a library program is under "Assigned to"), one "Filter by" control, no headings, no fold.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const grid = read("components/coach/desktop/program-card-grid.tsx");
const page = read("app/(coach)/programs/page.tsx");
const list = read("components/coach/desktop/programs-list.tsx");

const P = (id: string, over: Partial<FilterableProgram> = {}): FilterableProgram => ({ id, athleteId: null, athleteName: null, sourceProgramId: null, trainingIntent: null, updatedAt: null, ...over });
const library = P("lib1", { trainingIntent: "Hypertrophy", updatedAt: "2026-10-02" });
const library2 = P("lib2", { trainingIntent: "Mobility/Flow", updatedAt: "2026-10-05" });
const oneClient = P("oc1", { athleteId: "c1", athleteName: "Callie Smith", updatedAt: "2026-10-03" });
const copy = P("cp1", { athleteId: "c2", athleteName: "Will Jones", sourceProgramId: "lib1", updatedAt: "2026-10-04" });
const all = [library, library2, oneClient, copy];

describe("the flat Programs list and its one filter", () => {
  it("All programs = library + programs built for one client, never a client's copy of a library program", () => {
    expect(defaultList(all).map((p) => p.id)).toEqual(["lib1", "lib2", "oc1"]);
    expect(applyProgramsFilter(all, "all", null).map((p) => p.id)).toEqual(["lib1", "lib2", "oc1"]);
  });
  it("Shared programs = the library only", () => {
    expect(applyProgramsFilter(all, "shared", null).map((p) => p.id)).toEqual(["lib1", "lib2"]);
  });
  it("One client shows that client's programs, including their copies", () => {
    expect(applyProgramsFilter(all, "client", "c2").map((p) => p.id)).toEqual(["cp1"]);
    expect(applyProgramsFilter(all, "client", "c1").map((p) => p.id)).toEqual(["oc1"]);
    expect(clientOptions(all)).toEqual([{ id: "c1", name: "Callie Smith" }, { id: "c2", name: "Will Jones" }]);
  });
  it("Program type narrows the default list to one training type", () => {
    expect(typeOptions(all)).toEqual(["Hypertrophy", "Mobility/Flow"]);
    expect(applyProgramsFilter(all, "type", "Mobility/Flow").map((p) => p.id)).toEqual(["lib2"]);
  });
  it("is newest changed first, and names a client by first name", () => {
    expect(newestFirst(defaultList(all)).map((p) => p.id)).toEqual(["lib2", "oc1", "lib1"]);
    expect(firstName("Callie Smith")).toBe("Callie");
  });
});

describe("Programs page sections", () => {
  it("never shows the old Client Programs heading or its empty message, a Shared Programs heading, or a fold", () => {
    for (const old of ["Client Programs", "No individually-assigned programs yet", "Shared Programs", "No shared programs yet"]) {
      expect(grid, old).not.toContain(old);
    }
    expect(page).not.toContain("<details");
    expect(page).not.toContain("Programs made for one client");
  });
  it("has the approved filter strings and the plain empty line", () => {
    for (const s of ["Filter by", "All programs", "Shared programs", "One client", "Choose a client", "Program type"]) expect(list, s).toContain(s);
    expect(grid).toContain("No programs yet. Tap Build program.");
  });
  it("cards say Assigned to (n) for library programs and For [first name] for one-client programs", () => {
    expect(grid).toContain("Assigned to ({program.assignedCount ?? 0})");
    expect(grid).toContain("For {firstName(program.athleteName)}");
  });
});
