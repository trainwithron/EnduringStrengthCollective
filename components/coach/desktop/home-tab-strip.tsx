import Link from "next/link";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { stripEntries, type HomeTab } from "@/lib/desktop-coach-homes";

// FIX 6: the tabs of the home this page belongs to, at the top of the page on a computer (lib/desktop-coach-homes.ts picks the home and the tab from the address). Plain links: every tab is
// its own page with its own address. Styled like the client profile's tabs. Only the home's first tab is prefetched (the rest load on a click: Oct 20, Home's prefetches at once).
// Tabs in a group show as one tab, with a row of buttons under the strip for the group's pages (Settings, Ron Nov 2).
export function HomeTabStrip({ label, tabs, current, counts = {} }: { label: string; tabs: HomeTab[]; current: string | null; counts?: Partial<Record<NonNullable<HomeTab["badge"]>, number>> }) {
  const entries = stripEntries(tabs);
  if (entries.length < 2) return null;
  const base = "relative h-11 px-3 font-body text-[13px] border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5";
  const openGroup = entries.find((e) => e.tabs.length > 1 && e.tabs.some((t) => t.key === current));
  const newTabProps = (t: HomeTab) => (t.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {});
  return (
    <>
      <nav aria-label={label} className={`hidden lg:flex flex-wrap items-end gap-x-1 border-b border-steel/20 ${openGroup ? "mb-3" : "mb-6"}`} data-home-strip>
        {entries.map((e, i) => {
          const on = e.tabs.some((t) => t.key === current);
          const first = e.tabs[0];
          const count = e.tabs.reduce((n, t) => n + (t.badge ? counts[t.badge] ?? 0 : 0), 0);
          return (
            <Link
              key={e.key}
              href={e.href}
              prefetch={i === 0 ? undefined : false}
              aria-current={on ? "page" : undefined}
              {...newTabProps(first)}
              className={`${base} ${on ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}
            >
              {e.tabs.length === 1 && first.termKey ? <SwappableTerm termKey={first.termKey} form="plural" className="capitalize" /> : e.label}
              {count > 0 && (
                <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-xs font-bold flex items-center justify-center" aria-label={`${count} new`}>
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {openGroup && (
        <nav aria-label={openGroup.label} className="hidden lg:flex flex-wrap gap-2 mb-6" data-home-substrip>
          {openGroup.tabs.map((t) => {
            const on = t.key === current;
            return (
              <Link
                key={t.key}
                href={t.href}
                prefetch={false}
                aria-current={on ? "page" : undefined}
                {...newTabProps(t)}
                className={`h-9 px-4 inline-flex items-center whitespace-nowrap font-body text-sm border ${on ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel hover:text-chalk"}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
