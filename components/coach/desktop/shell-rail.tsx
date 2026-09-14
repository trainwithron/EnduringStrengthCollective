"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export interface RailIcon {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  badge?: number;
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

  function showTooltip() {
    const rect = linkRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  function hideTooltip() {
    setTooltipPos(null);
  }

  return (
    <Link
      ref={linkRef}
      href={item.href}
      title={item.label}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
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
            style={{ top: tooltipPos.top, left: tooltipPos.left, transform: "translateY(-50%)" }}
            className="fixed pointer-events-none whitespace-nowrap bg-surface border border-steel/30 text-chalk font-body text-xs px-2 py-1 z-[100]"
          >
            {item.label}
          </span>,
          document.body
        )}
    </Link>
  );
}
