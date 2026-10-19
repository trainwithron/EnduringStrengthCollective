import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSplitWidth, readSplitWidth, writeSplitWidth, splitPathFor, MIN_LIST_PANEL_WIDTH, MAX_LIST_PANEL_WIDTH } from "./coach-shell-panel-storage";
import { isAllowedWorkspacePath } from "./workspace-destinations";

// Ron, Oct 19: "If you click Business, it should pull up the full Business page in that half, or Clients, it should pull up your full client list, or whatever the full page is ... it shouldn't be hard to do."
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const panel = read("components/coach/desktop/shell-list-panel.tsx");
const host = read("components/coach/desktop/split-half.tsx");

describe("each tile shows its full page", () => {
  it("Clients, Business, Calendar and Program open the full pages, all of them pages a pane may show", () => {
    const g = "6f1c2b3a-0000-4000-8000-000000000001";
    expect(splitPathFor("roster", g).path).toBe("/clients");
    expect(splitPathFor("business", g).path).toBe(`/groups/${g}/business`);
    expect(splitPathFor("calendar", g).path).toBe(`/groups/${g}/calendar`);
    expect(splitPathFor("program", g).path).toBe(`/groups/${g}/programs`);
    for (const v of ["roster", "business", "calendar", "program"] as const) expect(isAllowedWorkspacePath(splitPathFor(v, g).path)).toBe(true);
  });
  it("in the same frame the workspace panes use (the app's own pages, no top-window navigation, links stay inside)", () => {
    expect(host).toContain('import { PaneFrame } from "@/components/coach/workspace/pane-frame";');
    expect(read("components/coach/workspace/pane-frame.tsx")).not.toContain("allow-top-navigation");
    expect(panel).toContain("<SplitHalfSlot view={view} groupId={groupId} covered={dragging} />");
    for (const mini of ["RosterMiniList", "BusinessMiniDashboard", "CalendarMiniView", "ProgramPanelList"]) expect(panel).not.toContain(mini);
  });
  it("a team organization has no Business tile, and a Business view pinned earlier shows Clients instead", () => {
    expect(panel).toContain("{!hideMoney && (");
    expect(panel).toContain('hideMoney && pickedView === "business" ? "roster" : pickedView');
  });
});

describe("the main page is never touched", () => {
  it("nothing in the panel or the host navigates the main window", () => {
    for (const s of [panel, host]) {
      expect(s).not.toContain("router.push");
      expect(s).not.toContain("window.location.href =");
      expect(s).not.toContain("useRouter");
    }
  });
  it("the frames live in the coach layout, so the left half keeps its page while the other side changes pages", () => {
    const layout = read("app/(coach)/layout.tsx");
    expect(layout).toContain("<SplitHalfHost>{children}</SplitHalfHost>");
    // a frame is never moved in the page (that reloads it): with no slot on screen it is only hidden
    expect(host).toContain('{ display: "none" }');
    expect(host).toContain("return () => api.setSlot(null);");
  });
  it("only on a computer (the panel is lg and up), and never inside a page that is itself shown in a frame", () => {
    expect(panel).toContain('className="hidden lg:flex shrink-0 border-r border-steel/20 sticky top-14');
    expect(host).toContain("{!embedded &&");
  });
  it("the host hands the slots one stable value (a new object each render made every slot report itself again, forever: seen in a browser)", () => {
    expect(host).toContain("const api = useMemo(() => ({ setSlot }), [setSlot]);");
    expect(host).toContain("<Ctx.Provider value={api}>");
    expect(host).not.toContain("value={{ setSlot }}");
  });
  it("the frame does not swallow the mouse while the divider is dragged", () => {
    expect(host).toContain('pointerEvents: slot.covered ? "none" : undefined');
  });
});

describe("the half is half the window until the coach drags it, then that width is remembered", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } };
  });
  it("defaults to half the window", () => {
    expect(defaultSplitWidth(1920)).toBe(960);
    expect(readSplitWidth(1440)).toBe(720);
    expect(defaultSplitWidth(300)).toBe(MIN_LIST_PANEL_WIDTH);
  });
  it("a dragged width is remembered, within the limits, under its own key (an old narrow width does not carry over)", () => {
    store.set("coach-shell-list-panel-width", "320");
    expect(readSplitWidth(1600)).toBe(800);
    writeSplitWidth(612.4);
    expect(store.get("coach-shell-split-width")).toBe("612");
    expect(readSplitWidth(1600)).toBe(612);
    writeSplitWidth(99999);
    expect(readSplitWidth(1600)).toBe(MAX_LIST_PANEL_WIDTH);
  });
  it("the panel reads and writes that width", () => {
    expect(panel).toContain("setWidth(readSplitWidth(window.innerWidth));");
    expect(panel).toContain("writeSplitWidth(w);");
  });
});
