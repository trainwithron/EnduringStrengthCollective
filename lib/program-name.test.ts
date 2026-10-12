import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProgramName, cleanImportedProgramName, PROGRAM_NAME_MAX } from "@/lib/program-name";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Renaming a program", () => {
  it("trims, refuses a blank name and a name that is too long", () => {
    expect(checkProgramName("  Christmas   Abs  ")).toEqual({ ok: true, name: "Christmas Abs" });
    expect(checkProgramName("   ")).toEqual({ ok: false, message: "Give it a name." });
    expect(checkProgramName("x".repeat(PROGRAM_NAME_MAX + 1)).ok).toBe(false);
    expect(checkProgramName("x".repeat(PROGRAM_NAME_MAX)).ok).toBe(true);
  });
  it("the input saves on Enter or leaving, cancels on Escape, changes only this program, and an update that touched no row is a failure", () => {
    const src = read("components/coach/program-name-input.tsx");
    expect(src).toContain('e.key === "Enter"');
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain("onBlur={() => void save()}");
    expect(src).toContain('.update({ name: checked.name }).eq("id", programId).select("id")');
    expect(src).toContain("data.length === 0");
    expect(src).toContain("Couldn't rename it");
  });
  it("the library card menu and the client Programs rows offer Rename and edit the name in place", () => {
    expect(read("components/coach/desktop/program-card-menu.tsx")).toContain("Rename");
    expect(read("components/coach/client-program-menu.tsx")).toContain("Rename");
    expect(read("components/coach/desktop/program-card-grid.tsx")).toContain("<ProgramNameInput");
    expect(read("components/coach/client-program-row.tsx")).toContain("<ProgramNameInput");
    expect(read("components/coach/desktop/client-programs-section.tsx")).toContain("<ClientProgramRow");
  });
});

describe("Imported program names", () => {
  it("a file-style name becomes readable words; a name someone capitalised is left alone", () => {
    expect(cleanImportedProgramName("christmas_abs_program")).toBe("Christmas Abs Program");
    expect(cleanImportedProgramName("christmas_abs_program.xlsx")).toBe("Christmas Abs Program");
    expect(cleanImportedProgramName("Large_and_In_Charge")).toBe("Large and In Charge");
    expect(cleanImportedProgramName("Lil SauceX")).toBe("Lil SauceX");
    expect(cleanImportedProgramName("")).toBe("");
  });
  it("the import review screen shows the name for the coach to confirm", () => {
    const src = read("components/coach/desktop/import-wizard.tsx");
    expect(src).toContain("cleanImportedProgramName(programName)");
    expect(src).toContain("Program name");
  });
});

describe("The name saved when an import creates the program", () => {
  it("keeps every letter (a name with s in it is unchanged), collapses runs of spaces, trims, and cuts to the limit", async () => {
    const { tidyProgramName } = await import("@/lib/program-name");
    expect(tidyProgramName("Strength Basics 12-Week")).toBe("Strength Basics 12-Week");
    expect(tidyProgramName("Christmas Abs")).toBe("Christmas Abs");
    expect(tidyProgramName("  a   b ")).toBe("a b");
    expect(tidyProgramName("   ")).toBe("");
    expect(tidyProgramName("x".repeat(PROGRAM_NAME_MAX + 30)).length).toBe(PROGRAM_NAME_MAX);
  });
  it("finalizeImport uses it (and no hand-written pattern that could lose a backslash)", () => {
    const src = read("components/coach/desktop/import-wizard.tsx");
    expect(src).toContain("const programName = tidyProgramName(importData.programName);");
    expect(src).not.toMatch(/programName\.replace\(\/s\+\//);
  });
});
