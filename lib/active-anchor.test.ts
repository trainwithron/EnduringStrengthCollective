import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chooseActiveAnchor } from "@/lib/active-anchor";
import { rememberedGroupForActiveOrg } from "@/lib/active-org";
import type { CoachedGroup } from "@/lib/coach-groups";

const g = (id: string, name: string, orgId: string, orgName: string, kind: CoachedGroup["kind"] = "team"): CoachedGroup => ({ id, name, orgId, orgName, kind });

// Ron's three organizations: the biggest one's team group sorts FIRST by name, which used to win every click on Programs, Calendar and Clients.
const groups = [
  g("collective", "The Enduring Strength Collective", "es", "Enduring Strength Co."),
  g("client-a", "Amber Belt", "es", "Enduring Strength Co.", "one_on_one"),
  g("client-b", "Brendan Jacobs", "es", "Enduring Strength Co.", "one_on_one"),
  g("home", "The Home Team", "c2c", "Coast2Coast Fitness"),
  g("trojans", "Trojans", "lee", "Lee County West Trojans"),
];

describe("which organization a coach-level page stands on", () => {
  it("stays in the organization the coach chose, on every tab, whatever the group names sort like", () => {
    // He switched to Coast2Coast (the switcher remembers The Home Team); each tab asks the same question and must get the same organization.
    for (const tab of ["Business", "Programs", "Calendar", "Messages", "Clients", "Nutrition", "Packages"]) {
      const r = chooseActiveAnchor(groups, "home");
      expect(r, tab).not.toBeNull();
      expect(r!.orgId, tab).toBe("c2c");
      expect(r!.anchor.id, tab).toBe("home");
      expect(r!.needsChoice, tab).toBe(false);
    }
    expect(chooseActiveAnchor(groups, "trojans")!.orgId).toBe("lee");
  });
  it("never lands in another organization's group because its name sorts first", () => {
    expect(chooseActiveAnchor(groups, "home")!.anchor.id).not.toBe("collective");
  });
  it("a remembered one-on-one client's group still names its organization, and the anchor is that organization's team group", () => {
    const r = chooseActiveAnchor(groups, "client-a");
    expect(r!.orgId).toBe("es");
    expect(r!.anchor.id).toBe("collective");
  });
  it("with several organizations and nothing valid remembered, the page asks instead of guessing", () => {
    expect(chooseActiveAnchor(groups, null)!.needsChoice).toBe(true);
    expect(chooseActiveAnchor(groups, "a-group-that-is-gone")!.needsChoice).toBe(true);
  });
  it("with one organization there is nothing to choose", () => {
    const one = groups.filter((x) => x.orgId === "es");
    expect(chooseActiveAnchor(one, null)!.needsChoice).toBe(false);
    expect(chooseActiveAnchor(one, null)!.orgId).toBe("es");
  });
  it("a coach with no groups has no anchor", () => {
    expect(chooseActiveAnchor([], "home")).toBeNull();
  });
});

// Ron's bug: he chose Enduring Strength Co., then a plain /calendar showed Coast2Coast, because opening any group page (even a prefetched link) rewrote "the last group opened", which used to BE the organization.
// Now the organization is its own cookie (active_org); the last group opened only picks a group inside it. Cookies at the time: last_group = Trojans, last_workspace_group = a placeholder id.
describe("the chosen organization is its own cookie", () => {
  const PLACEHOLDER = "11111111-2222-3333-4444-555555555555";
  const stand = (activeOrg: string | null, lastWorkspace: string | null) => chooseActiveAnchor(groups, rememberedGroupForActiveOrg(groups, activeOrg, lastWorkspace));
  it("a valid chosen organization wins, even when the last group opened is in another organization", () => {
    const r = stand("es", "home");
    expect(r!.orgId).toBe("es");
    expect(r!.anchor.id).toBe("collective");
    expect(r!.needsChoice).toBe(false);
    expect(stand("c2c", "trojans")!.orgId).toBe("c2c");
    expect(stand("lee", PLACEHOLDER)!.orgId).toBe("lee");
  });
  it("the last group opened inside the chosen organization is still the group used", () => {
    const two = [...groups, g("es-b", "Second Team", "es", "Enduring Strength Co.")];
    expect(rememberedGroupForActiveOrg(two, "es", "es-b")).toBe("es-b");
    expect(rememberedGroupForActiveOrg(two, "es", "home")).toBe("collective");
  });
  it("nothing chosen, or a chosen organization that is not the coach's (a stale or placeholder value), sends a coach with three organizations to the chooser, never to the first", () => {
    for (const bad of [null, "", PLACEHOLDER, "not-an-org"]) {
      expect(rememberedGroupForActiveOrg(groups, bad, "trojans"), String(bad)).toBeNull();
      expect(stand(bad, "trojans")!.needsChoice, String(bad)).toBe(true);
      expect(stand(bad, PLACEHOLDER)!.needsChoice, String(bad)).toBe(true);
    }
  });
  it("a coach with one organization is never asked", () => {
    const one = groups.filter((x) => x.orgId === "es");
    expect(chooseActiveAnchor(one, rememberedGroupForActiveOrg(one, PLACEHOLDER, PLACEHOLDER))!.needsChoice).toBe(false);
  });
  it("a one-on-one client's group is not a home for the organization", () => {
    expect(rememberedGroupForActiveOrg(groups.filter((x) => x.kind === "one_on_one"), "es", "client-a")).toBeNull();
  });
});

describe("the pieces that make the choice stick", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  it("only a deliberate choice writes the organization cookie: the chooser, the switcher and the phone hub write it; the middleware and the shell (which follow every page opened) do not", () => {
    for (const f of ["app/choose-organization/select/route.ts", "components/coach/desktop/org-switcher.tsx", "components/coach/mobile/coach-spot-hub.tsx"]) expect(read(f), f).toContain("ACTIVE_ORG_COOKIE");
    // the middleware READS the choice (FIX 4: a page of another organization asks first) but never writes it; the shell does neither
    expect(read("lib/supabase/middleware.ts")).not.toMatch(/cookies\.set\(ACTIVE_ORG_COOKIE/);
    expect(read("components/coach/coach-desktop-shell.tsx")).not.toContain("ACTIVE_ORG_COOKIE");
  });
  it("every reader of the organization goes through rememberedGroupForActiveOrg", () => {
    for (const f of ["lib/active-anchor.ts", "app/(coach)/dashboard/page.tsx", "app/coach-landing/route.ts", "lib/active-org-groups.ts", "components/coach/mobile/coach-spot-hub.tsx"]) expect(read(f), f).toContain("rememberedGroupForActiveOrg(");
  });
  it("every coach-level page sends the coach to the chooser instead of guessing", () => {
    for (const f of ["app/(coach)/programs/page.tsx", "app/(coach)/clients/page.tsx", "app/(coach)/calendar/page.tsx", "app/(coach)/group-calendar/page.tsx"]) {
      expect(read(f)).toContain("active?.needsChoice");
    }
    expect(read("app/(coach)/dashboard/page.tsx")).toContain('redirect("/choose-organization?next=/dashboard")');
  });
  it("the chooser lists organization names only and the selection checks the organization is the coach's own", () => {
    const page = read("app/choose-organization/page.tsx");
    expect(page).toContain("coachedOrgs(");
    expect(page).not.toContain("full_name");
    const route = read("app/choose-organization/select/route.ts");
    expect(route).toContain("groups.filter((g) => g.orgId === orgId)");
    expect(route).toContain('safeNextPath(rawNext, url.origin, "/dashboard")');
  });
  it("Ask Spot does not guess an organization either", () => {
    expect(read("app/api/collective-intelligence/chat/route.ts")).toContain("!activeAnchor.needsChoice");
  });
});
