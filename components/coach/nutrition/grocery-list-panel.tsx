"use client";

import { useMemo, useState } from "react";
import { compileGroceryList, groceryListText, type GroceryOptions, type PlanDay } from "@/lib/grocery-list";

// The week's grocery list from the SAVED meal plan: the foods and amounts of the days ahead, added up and rounded to what a person buys. It shows what the plan says, swaps included.
// Copy puts it on the clipboard as plain text; Print prints just this list.
export function GroceryListPanel({ days, clientName, metric }: { days: PlanDay[]; clientName: string; metric: boolean }) {
  const [mode, setMode] = useState<NonNullable<GroceryOptions["mode"]>>("featured");
  const [trainingDays, setTrainingDays] = useState(4);
  const [copied, setCopied] = useState(false);
  const hasCycling = days.some((d) => Array.isArray(d.meals.train) && d.meals.train.length > 0 && Array.isArray(d.meals.rest) && d.meals.rest.length > 0);
  const list = useMemo(() => compileGroceryList(days, { mode, trainingDaysPerWeek: trainingDays, metric }), [days, mode, trainingDays, metric]);
  const title = `Grocery list for ${clientName}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(groceryListText(list, title.toUpperCase()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (days.length === 0 || list.daysCounted === 0) {
    return <p className="font-body text-sm text-steel border border-steel/20 p-4">No saved meal plan for the coming week yet. Build the week above and the grocery list appears here.</p>;
  }

  return (
    <div className="space-y-3" id="grocery-print">
      <style>{`@media print { body * { visibility: hidden; } #grocery-print, #grocery-print * { visibility: visible; } #grocery-print { position: absolute; left: 0; top: 0; width: 100%; color: #000; background: #fff; } #grocery-print .no-print { display: none !important; } }`}</style>
      <p className="font-body text-xs text-steel max-w-[70ch]">
        {list.daysCounted} {list.daysCounted === 1 ? "day" : "days"} of the saved plan, starting today. Amounts are the plan&apos;s, added up and rounded to what you buy.
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
        <button type="button" onClick={copy} className="min-h-[44px] px-4 border border-steel/40 text-chalk font-body text-sm">
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => window.print()} className="min-h-[44px] px-4 border border-steel/40 text-chalk font-body text-sm">
          Print
        </button>
      </div>

      <h3 className="font-display uppercase text-sm tracking-wide hidden print:block">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.categories.map((c) => (
          <section key={c.key} aria-label={c.label} className="border border-steel/20 p-3">
            <h4 className="font-display uppercase text-xs tracking-wide text-steel mb-1.5">{c.label}</h4>
            <ul className="space-y-1">
              {c.items.map((i) => (
                <li key={`${i.name}|${i.unit}`} className="font-body text-sm text-chalk">
                  <strong>{i.name}:</strong> <span className="text-steel [font-variant-numeric:tabular-nums]">{i.display}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {list.unstructured.length > 0 && (
        <section className="border border-amber-400/40 p-3" aria-label="Foods without amounts">
          <h4 className="font-display uppercase text-xs tracking-wide text-amber-400 mb-1">Also in the plan (amounts not kept)</h4>
          <p className="font-body text-xs text-steel mb-1">These foods are in the plan but their amounts are not stored, so they could not be added up. Check the plan for how much.</p>
          <p className="font-body text-sm text-chalk">{list.unstructured.join(", ")}</p>
        </section>
      )}
    </div>
  );
}
