"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { InitialsAvatar } from "@/components/shared/initials-avatar";
import { DEFAULT_CLIENTS_VIEW, NUTRITION_CLIENTS_VIEW_KEY, readClientsView, writeClientsView, type ClientsView } from "@/lib/clients-view-pref";
import { CARD_WEEK_DAYS as WEEK_DAYS, DEFAULT_PERIOD, PERIOD_LABELS, cardBody, nothingLoggedLine, type Band, type CardFlags, type CardMacros, type Period } from "@/lib/nutrition-cards";

export interface NutritionCard {
  id: string;
  groupId: string;
  fullName: string;
  href: string;
  // Null when the week's numbers could not be read (the page says so once, above the cards).
  daysLogged: number | null;
  lastLine: string | null;
  macros: CardMacros | null;
  flags: CardFlags;
}

const FILL: Record<Band, string> = { hit: "bg-win", under: "bg-amber", over: "bg-alert", neutral: "bg-steel/60" };

// The Clients tab of Nutrition with nothing picked (Ron, Nov 24): a card per client like the Clients page, with their prescription as a faint bar and what they ate as the fill, for
// the 7-day average (the logged days only) or today. "List" is the list and page beside it as before (`list`). The Cards/List choice is kept in this browser, like the Clients page's.
export function NutritionClientCards({ cards, self, failed, list }: { cards: NutritionCard[]; self: { name: string; href: string } | null; failed: boolean; list: ReactNode }) {
  const [view, setView] = useState<ClientsView>(DEFAULT_CLIENTS_VIEW);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  useEffect(() => {
    setView(readClientsView(typeof window === "undefined" ? null : window.localStorage, NUTRITION_CLIENTS_VIEW_KEY));
  }, []);
  function chooseView(next: ClientsView) {
    setView(next);
    writeClientsView(typeof window === "undefined" ? null : window.localStorage, next, NUTRITION_CLIENTS_VIEW_KEY);
  }

  return (
    <div data-nutrition-cards-view={view}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {view === "cards" && (
          <div role="group" aria-label="Period" className="flex p-0.5 gap-0.5 rounded-token-pill bg-surface-2 shrink-0">
            {(["average", "today"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={`h-11 sm:h-9 px-3 rounded-token-pill font-body text-[13px] ${period === p ? "bg-rust/15 text-rust-ink font-semibold" : "text-chalk hover:text-rust-ink"}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        )}
        <div role="group" aria-label="View" className="ml-auto flex p-0.5 gap-0.5 rounded-token-pill bg-surface-2 shrink-0">
          {(["cards", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => chooseView(v)}
              className={`h-11 sm:h-9 px-3 rounded-token-pill font-body text-[13px] flex items-center gap-1.5 ${view === v ? "bg-rust/15 text-rust-ink font-semibold" : "text-chalk hover:text-rust-ink"}`}
            >
              {v === "cards" ? <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" /> : <List className="w-3.5 h-3.5" aria-hidden="true" />}
              {v === "cards" ? "Cards" : "List"}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        list
      ) : (
        <div>
          {failed && (
            <p className="font-body text-xs text-rust-ink mb-3" role="alert">
              Couldn&apos;t load this week&apos;s numbers. Reload to try again.
            </p>
          )}
          {self && (
            // The coach's own nutrition (their personal space), always first and never counted as a client.
            <Link href={self.href} className="flex items-center gap-3 min-h-11 rounded-card border border-transparent bg-surface hover:border-rust px-3 py-2 mb-3" data-nutrition-self>
              <InitialsAvatar name={self.name} tintKey={self.name} />
              <span className="font-body text-sm font-medium text-chalk truncate">{self.name} (you)</span>
            </Link>
          )}
          {cards.length === 0 ? (
            <p className="font-body text-sm text-steel py-6">No clients yet.</p>
          ) : (
            // Columns from the space the page has (as the Clients cards): one column on a phone.
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3" aria-label="Clients" data-nutrition-cards>
              {cards.map((c) => (
                <li key={`${c.id}|${c.groupId}`}>
                  <Link href={c.href} className="flex flex-col gap-3 min-h-11 h-full rounded-card border border-transparent bg-surface hover:border-rust p-3 active:bg-surface-2">
                    <span className="flex items-start gap-3">
                      <InitialsAvatar name={c.fullName} tintKey={c.id} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-body text-sm font-medium text-chalk break-words">{c.fullName}</span>
                        {c.lastLine && <span className="block font-body text-xs text-steel mt-0.5">{c.lastLine}</span>}
                      </span>
                      {c.daysLogged != null && (
                        <span className="flex flex-col items-end shrink-0">
                          <span className="font-display text-xl tabular-nums leading-none text-chalk">
                            {c.daysLogged}
                            <span className="text-sm text-steel">/{WEEK_DAYS}</span>
                          </span>
                          <span className="font-body text-[10px] text-steel mt-1">
                            days logged
                          </span>
                        </span>
                      )}
                    </span>
                    <CardMacrosView macros={c.macros} flags={c.flags} period={period} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[11px] text-steel mt-3" data-nutrition-cards-legend>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 h-2 rounded-full bg-surface-2" aria-hidden="true" />Prescription</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 h-2 rounded-full bg-win" aria-hidden="true" />On target (90–110%)</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 h-2 rounded-full bg-amber" aria-hidden="true" />Under</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block w-4 h-2 rounded-full bg-alert" aria-hidden="true" />Over 110%</span>
          </p>
          <p className="font-body text-[11px] text-steel mt-1">The 7-day average counts only the days they logged, not today.</p>
        </div>
      )}
    </div>
  );
}

function CardMacrosView({ macros, flags, period }: { macros: CardMacros | null; flags: CardFlags; period: Period }) {
  const body = cardBody(macros, flags, period);
  if (!body) return null;
  if (body.kind === "message") return <span className="block font-body text-xs text-steel bg-surface-2 rounded-card px-2.5 py-2">{body.text}</span>;
  if (body.kind === "nothing_logged")
    return (
      <span className="block font-body text-xs text-steel bg-surface-2 rounded-card px-2.5 py-2">
        Prescription {body.prescription}. {nothingLoggedLine(body.period)}
      </span>
    );
  return (
    <span className="grid gap-1.5" data-macro-bars>
      {body.bars.map((b) => (
        <span key={b.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 font-body text-[11px]">
          <span className="text-steel">{b.label}</span>
          <span role="img" aria-label={b.ariaLabel} className="relative block h-2.5 rounded-full bg-surface-2 overflow-hidden">
            <span className={`absolute inset-y-0 left-0 rounded-full ${FILL[b.band]}`} style={{ width: `${b.fill}%` }} data-band={b.band} />
          </span>
          <span className="text-right text-steel tabular-nums whitespace-nowrap" aria-hidden="true">
            <span className="text-chalk font-medium">{b.eaten.toLocaleString("en-US")}</span>
            {" / "}
            {b.target != null ? b.target.toLocaleString("en-US") : "–"}
            {b.unit ? ` ${b.unit}` : ""}
          </span>
        </span>
      ))}
    </span>
  );
}
