import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The desktop rail is coach-level and short (Ron, Oct 6): Home keeps it, a client's group never becomes Home's anchor, the business name is a real menu,
// and the advanced tools sit under More tools. Source-level guards so a later edit cannot bring the old behavior back.
const shell = readFileSync(new URL("./coach-desktop-shell.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../app/dashboard/page.tsx", import.meta.url), "utf8");
const finder = readFileSync(new URL("./desktop/client-finder.tsx", import.meta.url), "utf8");

describe("coach desktop shell", () => {
  it("never remembers a one-on-one client group as the Home anchor", () => {
    expect(shell).toContain('groupKind === "one_on_one") return;');
    expect(shell).toContain("last_group=");
  });
  it("the top-level rail is Clients, Calendar, Messages, Programming, Nutrition, Business, then More tools", () => {
    const navStart = shell.indexOf("const nav: NavEntry[] = [");
    const navEnd = shell.indexOf("const groupHasActiveChild");
    const nav = shell.slice(navStart, navEnd);
    const order = ['label: "Clients"', 'label: "Calendar"', 'label: "Messages"', 'label: "Programming"', 'label: "Nutrition"', 'label: "Business"', 'label: "More tools"'];
    let last = -1;
    for (const marker of order) {
      const at = nav.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
    // the duplicate Dashboard and the rarely used tools are not top-level any more
    expect(nav.indexOf('label: "Dashboard"')).toBe(-1);
    expect(nav.indexOf('label: "Zapier"')).toBeGreaterThan(nav.indexOf('label: "More tools"'));
    expect(nav.indexOf('label: "Hall of Fame"')).toBeGreaterThan(nav.indexOf('label: "More tools"'));
  });
  it("the business name is a menu and a coach-level page shows it as the title", () => {
    expect(shell).toContain("<WorkspaceMenu");
    expect(shell).toContain("coachLevel");
  });
});

describe("Home", () => {
  it("anchors the rail on a real team or social group, or stays coach-level", () => {
    expect(dashboard).toContain('active="home" coachLevel');
    expect(dashboard).toContain('g.group_kind !== "one_on_one"');
  });
});

describe("client finder wording", () => {
  it("uses the right article for the coach's own word", () => {
    expect(finder).toContain("withArticle(");
    expect(finder).not.toContain("`Find a ${clientWord");
  });
});
