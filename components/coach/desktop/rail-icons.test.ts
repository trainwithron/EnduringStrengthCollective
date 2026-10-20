import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shell = readFileSync(join(__dirname, "..", "coach-desktop-shell.tsx"), "utf8").replace(/\r\n/g, "\n");
const nav = shell.slice(shell.indexOf("const ordinaryNav: NavEntry[] = ["), shell.indexOf("// The team-sport menu:"));

describe("the three look-alike rail icons are now different", () => {
  it("Clients is a single person", () => {
    expect(nav).toContain('{ key: "clients", label: "Clients", href: CLIENTS_HREF, icon: UserRound,');
  });
  it("Programs (FIX 6: the Programs home's rail icon) is a dumbbell, and the grid icon is no longer used for programs", () => {
    expect(shell).toContain('const programsLeaf: NavLeaf = { key: "programs", label: "Programs", href: ALL_PROGRAMS_HREF, icon: Dumbbell,');
    expect(nav).toContain("programsLeaf,");
    expect(nav).not.toMatch(/icon: LayoutGrid/);
  });
  it("the hover labels stay", () => {
    expect(readFileSync(join(__dirname, "shell-rail.tsx"), "utf8")).toContain("aria-label={item.label}");
  });
});

describe("Exercise Library does not look like Programs", () => {
  it("FIX 6: it is a tab of the Programs home, not a rail icon, so the dumbbell is only Programs", () => {
    expect(nav).not.toContain('label: "Exercise library"');
    expect(shell.match(/icon: Dumbbell/g)?.length).toBe(1);
    expect(readFileSync(join(__dirname, "..", "..", "..", "lib", "desktop-coach-homes.ts"), "utf8")).toContain('{ key: "exercise-library", label: "Exercise library", href: `${g}/exercise-library` }');
  });
});
