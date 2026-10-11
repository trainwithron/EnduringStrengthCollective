import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const PAGE = "app/(coach)/groups/[groupId]/athletes/[athleteId]/view/page.tsx";

describe("View as client (desktop preview) is read only", () => {
  it("has no write code at all: no insert, update, upsert, delete or rpc in the data file or the page", () => {
    for (const rel of ["lib/client-preview-data.ts", PAGE, "components/coach/desktop/view-as-client-label.tsx"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src, rel).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
      expect(src, rel).not.toContain("<form");
      expect(src, rel).not.toContain("createBrowserClient");
    }
  });
  it("never uses the act-as cookie, and the preview page is a server page with no client JS of its own", () => {
    const page = read(PAGE);
    expect(page).not.toContain("acting_as");
    expect(page).not.toContain("act-as");
    expect(page).not.toContain("getEffectiveAthlete");
    expect(page).not.toContain('"use client"');
    expect(read("lib/client-preview-data.ts")).not.toContain("cookies(");
  });
  it("checks that the viewer coaches this group and that the client is an athlete in it, before showing anything", () => {
    const page = read(PAGE);
    expect(page).toContain('viewer?.role !== "coach" || client?.role !== "athlete"');
    expect(page.indexOf('viewer?.role !== "coach"')).toBeLessThan(page.indexOf("loadHome("));
    expect(page).toContain("You can only view a client you coach.");
  });
  it("Change lists only clients in groups this coach coaches", () => {
    const page = read(PAGE);
    expect(page).toContain('.eq("profile_id", user.id).eq("role", "coach")');
    expect(page).toContain('.in("group_id", coachedIds).eq("role", "athlete")');
  });
  it("has the four screens, the slim bar with Change and Exit, and Open full profile (no logging on desktop)", () => {
    const page = read(PAGE);
    for (const label of ["Home", "Programs", "History", "Calendar"]) expect(page).toContain(`label: "${label}"`);
    expect(page).toContain("Viewing as");
    expect(page).toContain("Change");
    expect(page).toContain("Exit");
    expect(page).not.toContain("Log their workout");
    expect(page).toContain("Open full profile");
  });
  it("the entry points are on the client's profile and the client list, desktop only, and use the coach's own word for a client", () => {
    const profile = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(profile).toContain("<ViewAsClientLink href={`/groups/${params.groupId}/athletes/${params.athleteId}/view`} />");
    expect(profile).toContain("hidden lg:inline-flex");
    const list = read("components/coach/desktop/client-card-grid.tsx");
    expect(list).toContain("/view`}");
    expect(list).toContain("hidden lg:inline");
    expect(read("components/coach/desktop/view-as-client-label.tsx")).toContain('View as {term("client")}');
  });
  it("History marks coach-logged sessions", () => {
    expect(read(PAGE)).toContain('l.loggedByCoach ? " · Coach logged" : ""');
  });
});
