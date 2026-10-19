"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PaneFrame } from "@/components/coach/workspace/pane-frame";
import { useEmbedded } from "@/components/shared/embedded-context";
import { splitPathFor, type ListPanelView } from "@/lib/coach-shell-panel-storage";

// The left half of the split screen (Ron, Oct 19: "I can leave my right side of my screen on whatever it's on ... I should be able to build a program on the left side").
// The list panel is drawn by each page, so a frame inside it would load again every time the other side moves to a new page, and a half-built program would be lost. So the
// frames live HERE, in the coach layout (which stays mounted while pages change), and sit exactly over the slot the panel leaves for them. A frame is never moved in the page
// (moving one reloads it); with no slot on screen (a page without the panel, the panel collapsed, a phone) the frames are only hidden, and keep their pages.
interface Slot {
  view: ListPanelView;
  groupId: string;
  rect: { top: number; left: number; width: number; height: number };
  covered: boolean;
}

interface SplitHalfApi {
  setSlot: (slot: Slot | null) => void;
}

const Ctx = createContext<SplitHalfApi | null>(null);

function frameKey(view: ListPanelView, groupId: string): string {
  return splitPathFor(view, groupId).path;
}

export function SplitHalfHost({ children }: { children: React.ReactNode }) {
  const embedded = useEmbedded();
  const [slot, setSlotState] = useState<Slot | null>(null);
  // Every page opened so far (by its address), in the order first opened. Each keeps its frame.
  const [opened, setOpened] = useState<{ key: string; view: ListPanelView; groupId: string }[]>([]);
  const setSlot = useCallback((next: Slot | null) => {
    setSlotState(next);
    if (!next) return;
    const key = frameKey(next.view, next.groupId);
    setOpened((prev) => (prev.some((o) => o.key === key) ? prev : [...prev, { key, view: next.view, groupId: next.groupId }]));
  }, []);
  // While the other side is loading its next page (a loading screen replaces the whole page, panel included), the half stays where it was instead of vanishing: the last slot is held until the next
  // page is in. It then either brings its own slot, or has no panel and the half is hidden.
  const [held, setHeld] = useState<Slot | null>(null);
  const last = useRef<Slot | null>(null);
  useEffect(() => {
    if (slot) {
      last.current = slot;
      setHeld(null);
      return;
    }
    if (!last.current) return;
    const keep = last.current;
    const check = () => setHeld(document.querySelector("[data-loading-fallback]") ? keep : null);
    // At once too: the loading screen is often already on the page when this runs (and a page in the background gets no animation frames).
    check();
    const frame = requestAnimationFrame(check);
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, [slot]);
  const showing = slot ?? held;
  // The width the half takes from the left edge, for the loading screens to keep clear of (globals.css, [data-loading-fallback]).
  useEffect(() => {
    const root = document.documentElement;
    if (showing && !embedded) root.style.setProperty("--split-reserved", `${Math.round(showing.rect.left + showing.rect.width)}px`);
    else root.style.removeProperty("--split-reserved");
  }, [showing, embedded]);
  const shownKey = showing ? frameKey(showing.view, showing.groupId) : null;
  // One stable value: a new object on every render would make every slot report itself again, forever.
  const api = useMemo(() => ({ setSlot }), [setSlot]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {!embedded &&
        opened.map((o) => {
          const shown = o.key === shownKey && showing;
          const dest = splitPathFor(o.view, o.groupId);
          return (
            <div
              key={o.key}
              data-split-frame={o.key}
              className="fixed z-20 flex flex-col"
              style={shown ? { top: showing.rect.top, left: showing.rect.left, width: showing.rect.width, height: showing.rect.height, pointerEvents: showing.covered ? "none" : undefined } : { display: "none" }}
            >
              <PaneFrame pane={{ id: `split-${o.key}`, dest: { id: `split-${o.key}`, label: dest.label, path: dest.path, section: "Split screen" } }} hidden={!shown} />
            </div>
          );
        })}
    </Ctx.Provider>
  );
}

// The space in the list panel where the picked tile's full page shows. `covered` while the divider is dragged, so the frame does not swallow the mouse.
export function SplitHalfSlot({ view, groupId, covered }: { view: ListPanelView; groupId: string; covered: boolean }) {
  const api = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Slot["rect"] | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, []);

  useEffect(() => {
    if (!api || !rect || rect.width === 0) return;
    api.setSlot({ view, groupId, rect, covered });
  }, [api, view, groupId, rect, covered]);

  useEffect(() => {
    if (!api) return;
    return () => api.setSlot(null);
  }, [api]);

  return <div ref={ref} className="relative flex-1 min-h-0" data-split-half />;
}
