import Link from "next/link";
import { SwappableTerm } from "@/components/coach/swappable-term";
import type { HomeTab } from "@/lib/desktop-coach-homes";

// FIX 6: the tabs of the home this page belongs to, at the top of the page on a computer (lib/desktop-coach-homes.ts picks the home and the tab from the address). Plain links: every tab is
// its own page with its own address. Styled like the client profile's tabs. Only the home's first tab is prefetched (the rest load on a click: Oct 20, Home's prefetches at once).
export function HomeTabStrip({ label, tabs, current, counts = {} }: { label: string; tabs: HomeTab[]; current: string | null; counts?: Partial<Record<NonNullable<HomeTab["badge"]>, number>> }) {
  if (tabs.length < 2) return null;
  const base = "relative h-11 px-3 font-body text-[13px] border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5";
  return (
    <nav aria-label={label} className="hidden lg:flex flex-wrap items-end gap-x-1 border-b border-steel/20 mb-6" data-home-strip>
      {tabs.map((t, i) => {
        const on = t.key === current;
        const count = t.badge ? counts[t.badge] ?? 0 : 0;
        return (
          <Link
            key={t.key}
            href={t.href}
            prefetch={i === 0 ? undefined : false}
            aria-current={on ? "page" : undefined}
            {...(t.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={`${base} ${on ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}
          >
            {t.termKey ? <SwappableTerm termKey={t.termKey} form="plural" className="capitalize" /> : t.label}
            {count > 0 && (
              <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-xs font-bold flex items-center justify-center" aria-label={`${count} new`}>
                {count > 9 ? "9+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
