import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

// The workspace must outlive navigation of the main page. That holds only if it is mounted in a layout ABOVE the pages (a layout stays mounted while the pages under it
// change), and not inside each page's own shell (which is unmounted and mounted again on every navigation, reloading every pane and losing anything typed in them).
describe("the workspace is mounted above the pages", () => {
  it("the coach areas share one layout that holds the workspace host", () => {
    const layout = read("app/(coach)/layout.tsx");
    expect(layout).toContain("WorkspaceHost");
    for (const area of ["groups", "clients", "dashboard"]) {
      expect(existsSync(new URL(`../../../app/(coach)/${area}`, import.meta.url)), area).toBe(true);
      expect(existsSync(new URL(`../../../app/${area}`, import.meta.url)), `${area} must not also exist outside the group`).toBe(false);
    }
  });
  it("no page's shell owns the workspace: the shell only reports who and where it is", () => {
    const shell = read("components/coach/coach-desktop-shell.tsx");
    expect(shell).not.toContain("<WorkspaceProvider");
    expect(shell).not.toContain("<WorkspaceDock");
    expect(shell).not.toContain("<WorkspaceFloating");
    expect(shell).toContain("useWorkspaceRegistration");
    expect(shell).toContain("lg:mr-[var(--ws-dock,0px)]");
  });
  it("a framed page gets no workspace of its own", () => {
    const host = read("components/coach/workspace/workspace-host.tsx");
    expect(host).toMatch(/if \(embedded\) return <>\{children\}<\/>/);
  });
  it("the fetch wrapper is installed when the host loads, before any page creates a database client", () => {
    expect(read("components/coach/workspace/workspace-host.tsx")).toContain('import "@/lib/workspace-mutation"');
    expect(read("lib/workspace-mutation.ts").trimEnd().endsWith("ensureFetchWrapped();")).toBe(true);
  });
});
