import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("switching organization changes the look straight away", () => {
  it("the root layout stamps which remembered workspace its colors were made for", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toContain("data-workspace-group={workspaceGroup}");
    expect(layout).toContain("decodeWorkspaceCookie((await cookies()).get(LAST_WORKSPACE_GROUP_COOKIE)?.value)");
  });
  it("the coach area (which stays mounted between pages) asks for the layout again when the remembered workspace is a different one", () => {
    expect(src("app/(coach)/layout.tsx")).toContain("<OrgThemeSync />");
    const sync = src("components/shared/org-theme-sync.tsx");
    expect(sync).toContain("document.documentElement.dataset.workspaceGroup");
    expect(sync).toContain("if (remembered && remembered !== used) router.refresh();");
    expect(sync).toContain("[pathname, router]");
  });
  it("the mobile hub's organization switch refreshes too", () => {
    expect(src("components/coach/mobile/coach-spot-hub.tsx")).toContain("router.refresh(); // the colors, fonts and icon follow the organization chosen");
  });
});
