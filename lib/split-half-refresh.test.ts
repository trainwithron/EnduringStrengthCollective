import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_LAYOUT, splitPaneId, visiblePaneIds } from "./workspace-layout";
import { splitPathFor } from "./coach-shell-panel-storage";

// Oct 24: on a computer, a client added on the main page ("Test Client added. Nothing was sent to them.") never showed in the Clients list beside it ("All 19")
// until another page was opened. That list is the split screen's left half, a frame of /clients the layout keeps alive. After a save the workspace refreshes the
// frames the coach can see; the left half was never counted as seen, so it was only marked stale and never refreshed.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the split screen's left half is refreshed after a save, like a pane the coach can see", () => {
  it("the left half on screen counts as visible (so a save refreshes it at once)", () => {
    const id = splitPaneId(splitPathFor("roster", "g").path);
    expect(id).toBe("split-/clients");
    expect(visiblePaneIds(EMPTY_LAYOUT, { suspended: false, splitShownId: id }).has(id)).toBe(true);
  });
  it("with no left half on screen nothing extra is counted, and nothing is while no coach page is shown", () => {
    expect(visiblePaneIds(EMPTY_LAYOUT, { suspended: false, splitShownId: null }).size).toBe(0);
    expect(visiblePaneIds(EMPTY_LAYOUT, { suspended: true, splitShownId: "split-/clients" }).size).toBe(0);
  });
  it("the dock's open pane and unminimized cards are counted as before", () => {
    const layout = {
      dock: { open: true, width: 400, panes: [{ id: "d1" }, { id: "d2" }], activeId: "d2" },
      floating: [{ id: "f1", minimized: false }, { id: "f2", minimized: true }],
    } as unknown as Parameters<typeof visiblePaneIds>[0];
    expect([...visiblePaneIds(layout, { suspended: false, splitShownId: null })].sort()).toEqual(["d2", "f1"]);
  });
  it("the left half tells the workspace which frame is on screen, under the id its frame is registered with", () => {
    const split = read("components/coach/desktop/split-half.tsx");
    expect(split).toContain("setSplitShown(shownKey && !embedded ? splitPaneId(shownKey) : null);");
    expect(split).toContain("<PaneFrame pane={{ id: splitPaneId(o.key),");
    const ws = read("components/coach/workspace/workspace-context.tsx");
    expect(ws).toContain("const visibleIds = useMemo(() => visiblePaneIds(layout, { suspended, splitShownId }), [layout, suspended, splitShownId]);");
    expect(ws).toContain("registerFrame, setSplitShown, requestClose");
  });
  it("a frame asked to refresh re-reads softly (router.refresh keeps what is typed)", () => {
    const reporter = read("components/coach/workspace/embedded-activity-reporter.tsx");
    expect(reporter).toMatch(/e\.data\?\.type !== REFRESH_MESSAGE\) return;\n\s*router\.refresh\(\);/);
  });
  it("the add itself still refreshes the page it is on, on the computer and the phone", () => {
    const add = read("components/coach/desktop/add-client-button.tsx");
    expect(add.match(/router\.refresh\(\);/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
