"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export interface RailIcon {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  badge?: number;
  // Hover rail widgets (hover_expand_rail_widgets_idea.md) — a
  // glanceable popover shown on hover-with-dwell (desktop) or tap
  // (touch), instead of the plain label tooltip. Each icon's own
  // self-fetching widget component renders here — this component has no
  // opinion on what the content is, only how/when it's revealed.
  popover?: React.ReactNode;
}

// Discord/YouTube-inspired icon rail (coach_desktop_shell_identity_
// redesign.md, item 1) — 64px, icon-only, never collapses. Resolves
// this feature's own named open gap ("rail icon-to-destination map is
// placeholder") with a real IA: one icon per real top-level destination
// this app already has (the same set CoachDesktopShell's previous flat
// nav + group array exposed), not a mocked-up placeholder set. A
// multi-page group (Programming, Business, etc.) is represented by its
// first/primary page — its other pages stay reachable via the small
// section sub-nav ShellListPanel renders above the roster/business
// toggle when that section is active.
export function ShellRail({ icons, footer }: { icons: RailIcon[]; footer?: React.ReactNode }) {
  return (
    <aside className="hidden lg:flex w-16 shrink-0 flex-col items-center border-r border-steel/20 bg-graphite sticky top-14 h-[calc(100vh-56px)] py-2 gap-1">
      <div className="flex-1 w-full flex flex-col items-center gap-1">
        {icons.map((item) => (
          <RailIconButton key={item.key} item={item} />
        ))}
      </div>
      {footer && <div className="w-full border-t border-steel/20 pt-2 flex flex-col items-center gap-1">{footer}</div>}
    </aside>
  );
}

// Hover dwell delay (hover_expand_rail_widgets_idea.md) — "moving the
// cursor across the rail to get somewhere else" must not pop open every
// widget it passes; the same trick macOS dock previews / VS Code's
// activity bar use. Closes immediately on mouse-leave, no symmetric
// delay — a widget that lingers after the cursor has moved on reads as
// broken, not helpful.
const HOVER_DWELL_MS = 450;

// Real bug fix (2026-09-14, overnight audit): the tooltip below used to
// be a plain absolute-positioned span inside this link, relying on
// group-hover — but this rail and the adjacent resizable list panel
// (shell-list-panel.tsx) are BOTH `position: sticky`, each creating its
// own stacking context. The tooltip's z-index could only ever win inside
// the rail's own context; the list panel, a later DOM sibling with no
// competing z-index, painted over it by default regardless (same root
// cause as the download-app-button modal bug fixed earlier). Fixed the
// same way: a portal straight onto <body>, escaping every ancestor's
// stacking context — with the icon's own position computed on hover
// since a portaled element can no longer rely on CSS `left-full` against
// its original parent.
function RailIconButton({ item }: { item: RailIcon }) {
  const Icon = item.icon;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch(typeof window !== "undefined" && "ontouchstart" in window);
  }, []);

  function computePos() {
    const rect = linkRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { top: rect.top, left: rect.right + 10 };
  }

  function showTooltip() {
    if (item.popover) return; // The popover's own header is the label — no second floater.
    const pos = computePos();
    if (pos) setTooltipPos(pos);
  }

  function hideTooltip() {
    setTooltipPos(null);
  }

  function handleMouseEnter() {
    if (isTouch) return; // Touch uses tap, not hover — see handleClick.
    showTooltip();
    if (!item.popover) return;
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = setTimeout(() => {
      const pos = computePos();
      if (pos) setPopoverPos(pos);
      setPopoverOpen(true);
    }, HOVER_DWELL_MS);
  }

  function handleMouseLeave() {
    hideTooltip();
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    setPopoverOpen(false);
  }

  useEffect(() => {
    return () => {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    };
  }, []);

  // Touch fallback (hover_expand_rail_widgets_idea.md) — hover doesn't
  // exist on a touchscreen, a real possibility given the school/team-
  // sports buyer. First tap on an icon with a widget previews it instead
  // of navigating away immediately; a second tap on the same icon (or
  // the "Open" link inside the popover) proceeds to the real page —
  // matches the standard mobile "tap to preview, tap again to commit"
  // pattern already used for CSS :hover-only elements on touch browsers.
  function handleClick(e: React.MouseEvent) {
    if (!isTouch || !item.popover) return;
    if (!popoverOpen) {
      e.preventDefault();
      const pos = computePos();
      if (pos) setPopoverPos(pos);
      setPopoverOpen(true);
    }
    // Already open — let the click proceed and navigate normally.
  }

  return (
    <Link
      ref={linkRef}
      href={item.href}
      title={item.popover ? undefined : item.label}
      aria-label={item.label}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={`relative w-11 h-11 flex items-center justify-center transition-colors ${
        item.active ? "bg-rust/15 text-rust" : "text-steel active:text-chalk"
      }`}
    >
      <Icon className="w-5 h-5" strokeWidth={2.25} />
      {(item.badge ?? 0) > 0 && <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-rust" />}
      {/* Icon-only rail + "a lot of settings" (Ron's own framing) is a
          real discoverability risk — a fast, styled label beats waiting
          on the browser's native title tooltip. */}
      {tooltipPos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            style={{ top: tooltipPos.top + 22, left: tooltipPos.left, transform: "translateY(-50%)" }}
            className="fixed pointer-events-none whitespace-nowrap bg-surface border border-steel/30 text-chalk font-body text-xs px-2 py-1 z-[100]"
          >
            {item.label}
          </span>,
          document.body
        )}
      {popoverOpen &&
        item.popover &&
        popoverPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onMouseEnter={() => {
              if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
            }}
            onMouseLeave={() => setPopoverOpen(false)}
            // React's synthetic event system bubbles through the
            // component tree, not the portaled DOM location — without
            // this, any click inside the popover (a button, an inner
            // Link) still reaches this rail icon's own enclosing <Link>
            // and navigates away instead of running its own handler.
            onClick={(e) => e.stopPropagation()}
            style={{ top: popoverPos.top, left: popoverPos.left }}
            className="fixed z-[100] w-64 bg-surface border border-rust/30 rounded-token-lg p-3.5 shadow-[0_0_0_1px_rgb(var(--rust)/0.15),0_12px_32px_rgba(0,0,0,0.5),0_0_20px_rgb(var(--rust)/0.12)]"
          >
            {item.popover}
          </div>,
          document.body
        )}
    </Link>
  );
}
