import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shell = readFileSync(join(__dirname, "..", "coach-desktop-shell.tsx"), "utf8").replace(/\r\n/g, "\n");
const nav = shell.slice(shell.indexOf("const nav: NavEntry[] = ["), shell.indexOf("const groupHasActiveChild"));

describe("the three look-alike rail icons are now different", () => {
  it("Clients is a single person", () => {
    expect(nav).toContain('{ key: "clients", label: "Clients", href: CLIENTS_HREF, icon: UserRound,');
  });
  it("Group is a cluster of three people, drawn locally, not a library two-person icon", () => {
    expect(nav).toContain('label: "Group",\n      icon: ThreePeopleIcon as unknown as typeof LayoutGrid,');
    const svg = readFileSync(join(__dirname, "three-people-icon.tsx"), "utf8");
    expect(svg.match(/<circle/g)?.length).toBe(3);
  });
  it("Programs (the rail entry and its panel tab) is a dumbbell, and the grid icon is no longer used for programs", () => {
    expect(nav).toContain('label: "Programming",\n      icon: Dumbbell,');
    expect(nav).toContain('{ key: "programs", label: "Programs", href: ALL_PROGRAMS_HREF, icon: Dumbbell,');
    expect(nav).not.toMatch(/icon: LayoutGrid/);
  });
  it("the hover labels stay", () => {
    expect(readFileSync(join(__dirname, "shell-rail.tsx"), "utf8")).toContain("aria-label={item.label}");
  });
});
