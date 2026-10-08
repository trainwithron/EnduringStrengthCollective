"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { loadFoodDetail, searchFoods, type FoodDetail, type FoodHit } from "@/lib/food-search";
import { defaultServing, formatAmount, gramsFor, macrosOf, quantityProblem, scaleNutrients, servingOptions } from "@/lib/food-serving";
import { MEAL_SLOTS, MEAL_SLOT_LABEL, defaultMealSlot, insertUsdaEntry, type MealSlot } from "@/lib/food-entry";
import { completeness, formatNutrientAmount, panelRows } from "@/lib/nutrient-panel";

// The free, default way to log food: search the USDA foods, pick a serving (household measure, grams or ounces), see the full nutrient panel for that amount, choose the meal and
// add it. No AI, no cost. Both units are shown everywhere; a nutrient the food does not report says "not reported", never zero.
export function FoodSearchLog({
  athleteId,
  groupId,
  logDate,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [detail, setDetail] = useState<FoodDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [optionKey, setOptionKey] = useState("g");
  const [qtyText, setQtyText] = useState("100");
  const [slot, setSlot] = useState<MealSlot>(() => defaultMealSlot(new Date().getHours(), new Date().getMinutes()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const seq = useRef(0);

  // Search as the person types (after a short pause); the latest search wins.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const found = await searchFoods(createBrowserClient(), q);
      if (mine !== seq.current) return;
      setSearchFailed(found === null);
      setHits(found ?? []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  const options = useMemo(() => servingOptions(detail?.portions ?? []), [detail]);
  const option = options.find((o) => o.key === optionKey) ?? options[0];
  const qty = Number(qtyText);
  const problem = detail && option ? quantityProblem(option, qty) : null;
  const grams = detail && option && !problem ? gramsFor(option, qty) : null;
  const nutrients = useMemo(() => (detail && grams ? scaleNutrients(detail.per100g, grams) : null), [detail, grams]);
  const macros = nutrients ? macrosOf(nutrients) : null;
  const rows = nutrients ? panelRows(nutrients) : [];
  const complete = completeness(rows);

  async function pick(hit: FoodHit) {
    setError(null);
    setAdded(null);
    setLoadingDetail(true);
    const d = await loadFoodDetail(createBrowserClient(), hit.fdcId);
    setLoadingDetail(false);
    if (!d) {
      setError("Couldn't load that food. Try another.");
      return;
    }
    const start = defaultServing(servingOptions(d.portions));
    setDetail(d);
    setOptionKey(start.option.key);
    setQtyText(String(start.qty));
  }

  async function add() {
    if (!detail || !option || !grams || saving) return;
    setSaving(true);
    setError(null);
    const entry = await insertUsdaEntry(createBrowserClient(), {
      athleteId,
      groupId,
      logDate,
      mealSlot: slot,
      fdcId: detail.fdcId,
      description: detail.description,
      servingLabel: option.label,
      servingQty: qty,
      grams,
      per100g: detail.per100g,
    });
    setSaving(false);
    if (!entry) {
      setError("That didn't save. Try again.");
      return;
    }
    onLogged(entry);
    setAdded(`${detail.description} added to ${MEAL_SLOT_LABEL[slot].toLowerCase()}.`);
    setDetail(null);
    setQuery("");
    setHits(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[44px] border border-rust/60 text-rust font-body text-sm font-medium"
      >
        Search foods
      </button>
    );
  }

  return (
    <div className="border border-steel/20 p-3" data-testid="food-search">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="font-body text-xs text-steel uppercase tracking-wide">Search foods</p>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-2 font-body text-xs text-steel">
          Close
        </button>
      </div>

      {!detail && (
        <>
          <input
            type="search"
            inputMode="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chicken breast, rice, banana…"
            aria-label="Search foods"
            className="w-full min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk placeholder:text-steel/60"
          />
          {added && <p className="font-body text-xs text-rust mt-2">{added}</p>}
          {searching && <p className="font-body text-xs text-steel mt-2">Searching…</p>}
          {!searching && searchFailed && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              Couldn&apos;t search just now. Check your connection and try again.
            </p>
          )}
          {!searching && !searchFailed && hits && hits.length === 0 && (
            <p className="font-body text-xs text-steel mt-2">No foods found for that. Try a simpler word, like &quot;chicken&quot; instead of &quot;grilled chicken&quot;.</p>
          )}
          {hits && hits.length > 0 && (
            <ul className="mt-2 divide-y divide-steel/15 border border-steel/15 max-h-80 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.fdcId}>
                  <button type="button" onClick={() => pick(h)} disabled={loadingDetail} className="w-full text-left px-3 py-2 min-h-[44px] disabled:opacity-60">
                    <span className="block font-body text-sm text-chalk">{h.description}</span>
                    <span className="block font-body text-xs text-steel [font-variant-numeric:tabular-nums]">
                      Per 100 g (3.5 oz): {h.per100g.kcal != null ? `${Math.round(h.per100g.kcal)} kcal` : "calories not reported"}
                      {h.per100g.protein_g != null ? ` · ${formatNutrientAmount(h.per100g.protein_g)}p` : ""}
                      {h.per100g.carbs_g != null ? ` / ${formatNutrientAmount(h.per100g.carbs_g)}c` : ""}
                      {h.per100g.fat_g != null ? ` / ${formatNutrientAmount(h.per100g.fat_g)}f` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loadingDetail && <p className="font-body text-xs text-steel mt-2">Loading…</p>}
        </>
      )}

      {detail && option && (
        <div>
          <button type="button" onClick={() => setDetail(null)} className="min-h-[44px] font-body text-xs text-steel">
            &larr; Back to results
          </button>
          <p className="font-body text-sm text-chalk">{detail.description}</p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="block font-body text-xs text-steel mb-1">Amount</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                aria-label="Amount"
                className="w-24 min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk"
              />
            </label>
            <label className="block flex-1 min-w-[10rem]">
              <span className="block font-body text-xs text-steel mb-1">Serving</span>
              <select
                value={option.key}
                onChange={(e) => setOptionKey(e.target.value)}
                aria-label="Serving"
                className="w-full min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk"
              >
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block font-body text-xs text-steel mb-1">Meal</span>
              <select
                value={slot}
                onChange={(e) => setSlot(e.target.value as MealSlot)}
                aria-label="Meal"
                className="min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk"
              >
                {MEAL_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {MEAL_SLOT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {problem && <p className="font-body text-xs text-rust mt-2" role="alert">{problem}</p>}
          {grams != null && <p className="font-body text-xs text-steel mt-2">That is {formatAmount(grams)}.</p>}

          {macros && (
            <div className="mt-3 border border-steel/20 p-3">
              <p className="font-display text-xl leading-none [font-variant-numeric:tabular-nums]">
                {macros.calories} kcal{macros.caloriesComputed ? " (worked out from the macros)" : ""}
              </p>
              <p className="font-body text-xs text-steel mt-1 [font-variant-numeric:tabular-nums]">
                {formatNutrientAmount(macros.proteinG)}p / {formatNutrientAmount(macros.carbsG)}c / {formatNutrientAmount(macros.fatG)}f
              </p>
              <details className="mt-3">
                <summary className="font-body text-xs text-steel cursor-pointer min-h-[44px] flex items-center">
                  Full nutrient panel ({complete.reported} of {complete.total} reported for this food)
                </summary>
                <table className="w-full mt-1 font-body text-xs [font-variant-numeric:tabular-nums]">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-steel/15">
                        <td className="py-1 text-chalk">{r.label}</td>
                        <td className="py-1 text-right text-steel">{r.amount == null ? "not reported" : `${formatNutrientAmount(r.amount)} ${r.unit}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="font-body text-xs text-steel mt-2">Numbers come from the USDA food database. A nutrient marked &quot;not reported&quot; is not in that food&apos;s record; it does not mean the food has none.</p>
              </details>
            </div>
          )}

          <button
            type="button"
            onClick={add}
            disabled={!grams || saving}
            className="w-full min-h-[44px] mt-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {saving ? "Adding…" : `Add to ${MEAL_SLOT_LABEL[slot].toLowerCase()}`}
          </button>
        </div>
      )}

      {error && <p className="font-body text-xs text-rust mt-2" role="alert">{error}</p>}
    </div>
  );
}
