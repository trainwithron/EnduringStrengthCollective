import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assignedBlockMessage } from "@/lib/program-assigned";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("One program in the library, an independent version for each person", () => {
  it("the menu is Rename, Assign..., Duplicate..., Hide, Delete (the old Assign program / Position / Myself / two Duplicate items are gone)", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    for (const label of ["Rename", "Assign…", "Duplicate…", "Hide", "Delete"]) expect(menu).toContain(label);
    for (const gone of ["Assign program", "Assign to Position", "Assign to Myself", "Duplicate to another organization"]) expect(menu).not.toContain(gone);
    expect(menu.indexOf("Assign…")).toBeLessThan(menu.indexOf("Duplicate…"));
    expect(menu.indexOf("Hide")).toBeLessThan(menu.indexOf("{busy ? \"Deleting…\" : \"Delete\"}"));
  });
  it("Duplicate... offers my library (default) or another organization", () => {
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu).toContain("In my library");
    expect(menu).toContain("In another organization →");
  });
  it("the Assign panel lists who has it with Remove, and adds clients, Me, positions or the whole group with a start date and one Assign button", () => {
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    for (const text of ["Assigned to", "Not assigned to anyone yet.", "Remove", "Everyone in", "Start date", "Assign to ${count}", "position, "]) expect(panel).toContain(text);
    expect(panel).toContain("removeProgramMessage(programName, a.athleteName)");
    expect(panel).toContain('rpc("ensure_personal_space")');
    expect(panel).toContain("alreadyAssigned.has(");
  });
  it("Delete refuses while people have their own version, and says what to do", () => {
    expect(assignedBlockMessage(3)).toBe("This program is assigned to 3 people. Remove it from them first, or hide it instead.");
    expect(assignedBlockMessage(1)).toBe("This program is assigned to 1 person. Remove it from them first, or hide it instead.");
    const menu = read("components/coach/desktop/program-card-menu.tsx");
    expect(menu.indexOf("assignedBlockMessage(assignedCount)")).toBeLessThan(menu.indexOf('from("programs").delete()'));
  });
  it("the Programs page is one flat list of library programs and programs built for one client, never a client's version of a library program, with Assigned to (n) on library cards", () => {
    const page = read("app/(coach)/programs/page.tsx");
    expect(page).toContain("const cards = clientId ? scoped : defaultList(scoped);");
    expect(page).toContain("<ProgramsList");
    expect(page).not.toContain("<details");
    expect(page).toContain("countAssignedTo(");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("Assigned to ({program.assignedCount ?? 0})");
  });
  it("assigning always copies and adds no client name; nothing calls the attach step", () => {
    const lib = read("lib/program-duplication.ts");
    expect(lib).not.toContain("assign_program_to_client");
    const panel = read("components/coach/desktop/program-assign-panel.tsx");
    expect(panel).not.toContain("clientName");
    expect(read("components/coach/client-program-actions.tsx")).not.toContain("clientName: athleteFullName");
  });
});
