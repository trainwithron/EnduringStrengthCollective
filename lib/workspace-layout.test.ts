import { describe, it, expect } from "vitest";
import {
  EMPTY_LAYOUT,
  reduce,
  effectiveLayout,
  snapRect,
  tileFloating,
  sanitizeLayout,
  readLayout,
  writeLayout,
  migrateLegacy,
  MAX_DOCK_PANES,
  MAX_FLOATING,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  FLOAT_MIN_WIDTH,
  MIN_VIEWPORT_FOR_FLOATING,
  type WorkspaceLayout,
} from "./workspace-layout";
import type { WorkspaceDestination } from "./workspace-destinations";

const G = "0b1f4c2e-aaaa-4bbb-8ccc-123456789abc";
const dest = (key: string): WorkspaceDestination => ({ id: `page:${key}`, label: key, section: "s", path: `/groups/${G}/${key}` });
const bounds = { width: 1600, height: 900 };

describe("opening and closing", () => {
  it("opens a destination in the dock, makes it the active tab and remembers it", () => {
    const s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("calendar"), where: "dock" });
    expect(s.dock.panes.map((p) => p.id)).toEqual(["a"]);
    expect(s.dock.open).toBe(true);
    expect(s.dock.activeId).toBe("a");
    expect(s.recents[0].id).toBe("page:calendar");
  });
  it("never opens the same destination twice: it brings the open one forward", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("calendar"), where: "dock" });
    s = reduce(s, { type: "open", id: "b", dest: dest("messages"), where: "dock" });
    s = reduce(s, { type: "open", id: "c", dest: dest("calendar"), where: "floating", bounds });
    expect(s.dock.panes).toHaveLength(2);
    expect(s.floating).toHaveLength(0);
    expect(s.dock.activeId).toBe("a");
    // an open floating card is raised and un-minimized
    s = reduce(s, { type: "open", id: "d", dest: dest("business"), where: "floating", bounds });
    s = reduce(s, { type: "open", id: "e", dest: dest("programs"), where: "floating", bounds });
    s = reduce(s, { type: "minimize", id: "d", minimized: true });
    s = reduce(s, { type: "open", id: "x", dest: dest("business"), where: "floating", bounds });
    expect(s.floating[s.floating.length - 1].id).toBe("d");
    expect(s.floating[s.floating.length - 1].minimized).toBe(false);
  });
  it("refuses a destination that is not a page of the app", () => {
    const bad: WorkspaceDestination = { id: "x", label: "x", section: "", path: "https://evil.example" };
    expect(reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: bad, where: "dock" })).toBe(EMPTY_LAYOUT);
  });
  it("keeps to the limits", () => {
    let s: WorkspaceLayout = EMPTY_LAYOUT;
    for (let i = 0; i < MAX_DOCK_PANES + 3; i++) s = reduce(s, { type: "open", id: `d${i}`, dest: dest(`d${i}`), where: "dock" });
    expect(s.dock.panes).toHaveLength(MAX_DOCK_PANES);
    for (let i = 0; i < MAX_FLOATING + 3; i++) s = reduce(s, { type: "open", id: `f${i}`, dest: dest(`f${i}`), where: "floating", bounds });
    expect(s.floating).toHaveLength(MAX_FLOATING);
  });
  it("closing the active tab activates the last remaining one, and closing the last closes the dock", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("a"), where: "dock" });
    s = reduce(s, { type: "open", id: "b", dest: dest("b"), where: "dock" });
    s = reduce(s, { type: "close", id: "b" });
    expect(s.dock.activeId).toBe("a");
    s = reduce(s, { type: "close", id: "a" });
    expect(s.dock.open).toBe(false);
    expect(s.dock.activeId).toBeNull();
  });
});

describe("moving between dock and floating", () => {
  it("a tab can float and a card can dock, keeping what it shows", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("calendar"), where: "dock" });
    s = reduce(s, { type: "toFloating", id: "a", bounds });
    expect(s.dock.panes).toHaveLength(0);
    expect(s.dock.open).toBe(false);
    expect(s.floating[0].dest.id).toBe("page:calendar");
    s = reduce(s, { type: "toDock", id: "a" });
    expect(s.floating).toHaveLength(0);
    expect(s.dock.activeId).toBe("a");
  });
  it("reordering the dock tabs", () => {
    let s: WorkspaceLayout = EMPTY_LAYOUT;
    for (const k of ["a", "b", "c"]) s = reduce(s, { type: "open", id: k, dest: dest(k), where: "dock" });
    s = reduce(s, { type: "reorderDock", id: "c", toIndex: 0 });
    expect(s.dock.panes.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});

describe("floating card geometry", () => {
  const base = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("a"), where: "floating", bounds });
  it("a card cannot be dragged out of the window", () => {
    const s = reduce(base, { type: "move", id: "a", x: 99999, y: -50, bounds });
    expect(s.floating[0].x).toBeLessThanOrEqual(bounds.width - 120);
    expect(s.floating[0].y).toBe(0);
  });
  it("a card has a smallest size and cannot grow past the window", () => {
    let s = reduce(base, { type: "resize", id: "a", w: 10, h: 10, bounds });
    expect(s.floating[0].w).toBe(FLOAT_MIN_WIDTH);
    s = reduce(base, { type: "resize", id: "a", w: 99999, h: 99999, bounds });
    expect(s.floating[0].x + s.floating[0].w).toBeLessThanOrEqual(bounds.width);
  });
  it("raising puts a card on top, minimizing hides it without closing it", () => {
    let s = reduce(base, { type: "open", id: "b", dest: dest("b"), where: "floating", bounds });
    s = reduce(s, { type: "raise", id: "a" });
    expect(s.floating[s.floating.length - 1].id).toBe("a");
    s = reduce(s, { type: "minimize", id: "a", minimized: true });
    expect(s.floating.find((p) => p.id === "a")!.minimized).toBe(true);
  });
  it("snapping and tiling fill the space", () => {
    const left = snapRect("left", { width: 1000, height: 700 });
    const right = snapRect("right", { width: 1000, height: 700 });
    expect(left.x + left.w).toBeLessThanOrEqual(right.x + 1);
    expect(snapRect("full", { width: 1000, height: 700 })).toEqual({ x: 0, y: 0, w: 1000, h: 700 });
    let s: WorkspaceLayout = EMPTY_LAYOUT;
    for (const k of ["a", "b", "c", "d"]) s = reduce(s, { type: "open", id: k, dest: dest(k), where: "floating", bounds });
    const t = tileFloating(s, { width: 1000, height: 800 });
    expect(t.floating.map((p) => [p.x, p.y])).toEqual([[0, 0], [500, 0], [0, 400], [500, 400]]);
  });
});

describe("a floating card shown as a tab on a narrow window", () => {
  it("picking its tab docks it", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "f", dest: dest("a"), where: "floating", bounds });
    s = reduce(s, { type: "activate", id: "f" });
    expect(s.floating).toHaveLength(0);
    expect(s.dock.activeId).toBe("f");
  });
});

describe("replacing the whole layout (another tab, or loading)", () => {
  it("takes a good layout and repairs a bad one", () => {
    const good = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("calendar"), where: "dock" });
    expect(reduce(EMPTY_LAYOUT, { type: "replace", layout: good })).toEqual(good);
    expect(reduce(good, { type: "replace", layout: { version: 7 } as unknown as WorkspaceLayout })).toEqual(EMPTY_LAYOUT);
  });
});

describe("dock width and a narrow window", () => {
  it("the dock width stays within its limits", () => {
    expect(reduce(EMPTY_LAYOUT, { type: "setDockWidth", width: 10 }).dock.width).toBe(DOCK_MIN_WIDTH);
    expect(reduce(EMPTY_LAYOUT, { type: "setDockWidth", width: 99999 }).dock.width).toBe(DOCK_MAX_WIDTH);
  });
  it("below the floating threshold every card shows as a dock tab, and the saved layout is untouched", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("a"), where: "dock" });
    s = reduce(s, { type: "open", id: "b", dest: dest("b"), where: "floating", bounds });
    const narrow = effectiveLayout(s, MIN_VIEWPORT_FOR_FLOATING - 1);
    expect(narrow.floating).toHaveLength(0);
    expect(narrow.dock.panes.map((p) => p.id)).toEqual(["a", "b"]);
    expect(s.floating).toHaveLength(1);
    expect(effectiveLayout(s, MIN_VIEWPORT_FOR_FLOATING)).toBe(s);
  });
});

describe("saved layouts are untrusted", () => {
  it("round-trips through storage", () => {
    let s = reduce(EMPTY_LAYOUT, { type: "open", id: "a", dest: dest("calendar"), where: "dock" });
    s = reduce(s, { type: "open", id: "b", dest: dest("messages"), where: "floating", bounds });
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeLayout("coach1", s, storage);
    expect(readLayout("coach1", storage)).toEqual(s);
    expect(readLayout("someone-else", storage)).toBeNull();
  });
  it("repairs or drops bad entries and never throws", () => {
    expect(sanitizeLayout(null)).toEqual(EMPTY_LAYOUT);
    expect(sanitizeLayout("nope")).toEqual(EMPTY_LAYOUT);
    expect(sanitizeLayout({ version: 99 })).toEqual(EMPTY_LAYOUT);
    const messy = {
      version: 1,
      dock: {
        open: true,
        width: 1,
        activeId: "ghost",
        panes: [
          { id: "a", dest: dest("calendar") },
          { id: "a", dest: dest("messages") }, // repeated id
          { id: "c", dest: dest("calendar") }, // repeated destination
          { id: "d", dest: { id: "x", label: "x", section: "", path: "https://evil.example" } }, // outside address
          { id: "e" }, // no destination
        ],
      },
      floating: [{ id: "f", dest: dest("business"), x: -5, y: 1e9, w: 1, h: 1, minimized: "yes" }],
      recents: [dest("a"), dest("a"), { junk: true }],
    };
    const s = sanitizeLayout(messy);
    expect(s.dock.panes.map((p) => p.id)).toEqual(["a"]);
    expect(s.dock.activeId).toBe("a");
    expect(s.dock.width).toBe(DOCK_MIN_WIDTH);
    expect(s.floating[0]).toMatchObject({ x: 0, y: 4000, w: FLOAT_MIN_WIDTH, minimized: false });
    expect(s.recents).toHaveLength(1);
  });
  it("reading a corrupt value gives nothing instead of an error", () => {
    const storage = { getItem: () => "{not json" };
    expect(readLayout("c", storage)).toBeNull();
  });
});

describe("moving over from the old panel and card stack", () => {
  let n = 0;
  const id = () => `m${++n}`;
  it("an old panel showing Business becomes one dock tab with the same width", () => {
    const s = migrateLegacy({ panelView: "business", panelWidth: 500, panelCollapsed: false, layoutMode: "traditional", cards: [] }, G, id)!;
    expect(s.dock.panes[0].dest.path).toBe(`/groups/${G}/business`);
    expect(s.dock.width).toBe(500);
    expect(s.dock.open).toBe(true);
  });
  it("a collapsed old panel stays closed", () => {
    const s = migrateLegacy({ panelView: "roster", panelWidth: 320, panelCollapsed: true, layoutMode: "traditional", cards: [] }, G, id)!;
    expect(s.dock.open).toBe(false);
    expect(s.dock.panes).toHaveLength(1);
  });
  it("old floating cards keep their places", () => {
    const s = migrateLegacy(
      { panelView: null, panelWidth: null, panelCollapsed: null, layoutMode: "card_stack", cards: [{ view: "calendar", x: 40, y: 60, width: 500, height: 600 }, { view: "program", x: 10, y: 10, width: 400, height: 400 }] },
      G,
      id
    )!;
    expect(s.floating).toHaveLength(2);
    expect(s.floating[0]).toMatchObject({ x: 40, y: 60, w: 500, h: 600 });
    expect(s.floating[1].dest.path).toBe(`/groups/${G}/programs`);
  });
  it("nothing set up before means nothing to move over", () => {
    expect(migrateLegacy({ panelView: null, panelWidth: null, panelCollapsed: null, layoutMode: null, cards: [] }, G, id)).toBeNull();
  });
});
