"use client";

import { useEffect, useMemo, useState } from "react";
import { compileGroceryList, groceryItemId, groceryListText, type GroceryOptions, type PlanDay } from "@/lib/grocery-list";
import { getWeekDates } from "@/lib/meal-plan-assignment";

// The week's grocery list from the SAVED meal plan: the same food across every meal and day added into one line, grouped by aisle, in grams (and what a person buys), swaps
// included. Each item can be ticked off ("already have it"); a ticked item stays on the list, crossed off, and a second tap unticks it. The ticks are kept on this device only.
// Share sends it as plain text (or copies it where sharing is not offered); Print prints just this list.
export function GroceryListPanel({ days, clientName, metric, audience = "coach", storageKey: baseKey }: { days: PlanDay[]; clientName: string; metric: boolean; audience?: "coach" | "client"; storageKey?: string }) {
  // The ticks belong to one week's shopping: the key carries the Sunday of the week the list starts in.
  const storageKey = baseKey && days.length > 0 ? `${baseKey}:${getWeekDates(days[0].date)[0]}` : undefined;
  const [mode, setMode] = useState<NonNullable<GroceryOptions["mode"]>>("featured");
  const [trainingDays, setTrainingDays] = useState(4);
  const [copied, setCopied] = useState(false);
  const [have, setHave] = useState<Set<string>>(new Set());
  // The ticks from this device (a private window, or storage that is blocked, simply starts with none).
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setHave(new Set((JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string")));
    } catch {
      /* no saved ticks */
    }
  }, [storageKey]);
  function toggleHave(id: string) {
    setHave((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          /* kept for this visit only */
        }
      }
      return next;
    });
  }
  const hasCycling = days.some((d) => Array.isArray(d.meals.train) && d.meals.train.length > 0 && Array.isArray(d.meals.rest) && d.meals.rest.length > 0);
  const list = useMemo(() => compileGroceryList(days, { mode, trainingDaysPerWeek: trainingDays, metric }), [days, mode, trainingDays, metric]);
  const title = audience === "client" ? "Grocery list" : `Grocery list for ${clientName}`;

  async function share() {
    const text = groceryListText(list, title.toUpperCase(), have);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text });
        return;
      }
    } catch (e) {
      // The person closed the share sheet: nothing else to do.
      if ((e as { name?: string })?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (days.length === 0 || list.daysCounted === 0) {
    return (
      <p className="font-body text-sm text-steel border border-steel/20 p-4">
        {audience === "client" ? "Your coach hasn't saved a meal plan for the coming week yet. Your grocery list appears here once they do." : "No saved meal plan for the coming week yet. Build the week above and the grocery list appears here."}
      </p>
    );
  }

  return (
    <div className="space-y-3" id="grocery-print">
      <style>{`@media print { body * { visibility: hidden; } #grocery-print, #grocery-print * { visibility: visible; } #grocery-print { position: absolute; left: 0; top: 0; width: 100%; color: #000; background: #fff; } #grocery-print .no-print { display: none !important; } }`}</style>
      <p className="font-body text-xs text-steel max-w-[70ch]">
        {list.daysCounted} {list.daysCounted === 1 ? "day" : "days"} of the saved plan, starting today. Amounts are {audience === "client" ? "your" : "the"} plan&apos;s, added up and rounded to what you buy.
      </p>
      <div className="no-print flex flex-wrap items-center gap-3">
        <label className="font-body text-xs text-steel flex items-center gap-2">
          Count
          <select value={mode} onChange={(e) => setMode(e.target.value as "featured" | "split")} className="min-h-[44px] bg-surface border border-steel/30 px-2 text-chalk text-sm" aria-label="Which options to count">
            <option value="featured">The option shown first each day</option>
            <option value="split">Every option, an equal share of the days</option>
          </select>
        </label>
        {hasCycling && (
          <label className="font-body text-xs text-steel flex items-center gap-2">
            Training days a week
            <select value={trainingDays} onChange={(e) => setTrainingDays(Number(e.target.value))} className="min-h-[44px] bg-surface border border-steel/30 px-2 text-chalk text-sm">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={share} className="min-h-[44px] px-4 border border-steel/40 text-chalk font-body text-sm">
          {copied ? "Copied" : "Share"}
        </button>
        <button type="button" onClick={() => window.print()} className="min-h-[44px] px-4 border border-steel/40 text-chalk font-body text-sm">
          Print
        </button>
      </div>

      <p className="no-print font-body text-xs text-steel">
        Tick what {audience === "client" ? "you" : "they"} already have: it stays on the list, crossed off. Tap it again to untick it.
        {have.size > 0 && (
          <button type="button" onClick={() => { setHave(new Set()); if (storageKey) { try { window.localStorage.removeItem(storageKey); } catch { /* nothing kept */ } } }} className="ml-2 min-h-[44px] px-2 text-rust-ink underline underline-offset-2">
            Untick all
          </button>
        )}
      </p>
      <h3 className="font-display uppercase text-sm tracking-wide hidden print:block">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.categories.map((c) => (
          <section key={c.key} aria-label={c.label} className="border border-steel/20 p-3">
            <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-1.5">{c.label}</h4>
            <ul>
              {c.items.map((i) => {
                const id = groceryItemId(i);
                const got = have.has(id);
                return (
                  <li key={id}>
                    <label className="flex items-start gap-3 min-h-[44px] py-1.5 cursor-pointer font-body text-sm">
                      <input type="checkbox" checked={got} onChange={() => toggleHave(id)} aria-label={`Already have ${i.name}`} className="mt-0.5 w-5 h-5 shrink-0 accent-rust" />
                      <span className={got ? "text-steel line-through" : "text-chalk"} data-have={got ? "yes" : undefined}>
                        <strong>{i.name}:</strong> <span className="text-steel [font-variant-numeric:tabular-nums]">{i.display}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {list.unstructured.length > 0 && (
        <section className="border border-amber-400/40 p-3" aria-label="Foods without amounts">
          <h4 className="font-display uppercase text-xs tracking-wide text-amber-400 mb-1">Also in the plan (amounts not kept)</h4>
          <p className="font-body text-xs text-steel mb-1">These foods are in the plan but their amounts are not stored, so they could not be added up. {audience === "client" ? "Ask your coach how much." : "Check the plan for how much."}</p>
          <p className="font-body text-sm text-chalk">{list.unstructured.join(", ")}</p>
        </section>
      )}
    </div>
  );
}
