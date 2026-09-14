"use client";

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
      {/* No overflow-y-auto here on purpose — a real bounded icon set
          (~11 max) never needs scrolling in practice, and giving this
          wrapper any overflow value clips the hover-tooltip spans below,
          which position themselves via left-full outside this column's
          own width. */}
      <div className="flex-1 w-full flex flex-col items-center gap-1">
        {icons.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              title={item.label}
              className={`group relative w-11 h-11 flex items-center justify-center transition-colors ${
                item.active ? "bg-rust/15 text-rust" : "text-steel active:text-chalk"
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={2.25} />
              {(item.badge ?? 0) > 0 && (
                <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-rust" />
              )}
              {/* Icon-only rail + "a lot of settings" (Ron's own framing)
                  is a real discoverability risk — a fast, styled label
                  beats waiting on the browser's native title tooltip.
                  Hidden until hover so it never competes with the list
                  panel at rest. */}
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap bg-surface border border-steel/30 text-chalk font-body text-xs px-2 py-1 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-100 z-20">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      {footer && <div className="w-full border-t border-steel/20 pt-2 flex flex-col items-center gap-1">{footer}</div>}
    </aside>
  );
}
