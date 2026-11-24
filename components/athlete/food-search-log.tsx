"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { loadFoodDetail, type FoodDetail, type FoodHit } from "@/lib/food-search";
import { runFoodSearch } from "@/lib/food-search-run";
import { defaultServing, formatAmount, gramsFor, macrosOf, quantityProblem, scaleNutrients, servingOptions } from "@/lib/food-serving";
import { MEAL_SLOTS, MEAL_SLOT_LABEL, defaultMealSlot, insertUsdaEntry, type MealSlot } from "@/lib/food-entry";
import { completeness, formatNutrientAmount, panelRows } from "@/lib/nutrient-panel";
import { mlServingOptions, packagedDetail, packagedTitle, type PackagedHit } from "@/lib/packaged-foods";
import type { NutrientMap } from "@/lib/food-serving";
import { Search } from "lucide-react";

// "Per 100 g (3.5 oz): 61 kcal · 3.3p / 4.6c / 3.2f" (a value the food does not report is left out; missing calories say so). A packaged drink labelled by volume: "Per 100 ml".
export function per100Line(per100g: NutrientMap, unit: "g" | "ml" = "g"): string {
  return (
    `${unit === "ml" ? "Per 100 ml" : "Per 100 g (3.5 oz)"}: ${per100g.kcal != null ? `${Math.round(per100g.kcal)} kcal` : "calories not reported"}` +
    (per100g.protein_g != null ? ` · ${formatNutrientAmount(per100g.protein_g)}p` : "") +
    (per100g.carbs_g != null ? ` / ${formatNutrientAmount(per100g.carbs_g)}c` : "") +
    (per100g.fat_g != null ? ` / ${formatNutrientAmount(per100g.fat_g)}f` : "")
  );
}

// The free, default way to log food: search the USDA foods, pick a serving (household measure, grams or ounces), see the full nutrient panel for that amount, choose the meal and
// add it. No AI, no cost. Both units are shown everywhere; a nutrient the food does not report says "not reported", never zero.
export function FoodSearchLog({
  athleteId,
  groupId,
  logDate,
  onLogged,
  inSheet = false,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
  // Inside Home's Log food pop-up (CL10, Nov 21): open from the start, and the pop-up has the title and the close button.
  inSheet?: boolean;
}) {
  const [open, setOpen] = useState(inSheet);
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
  // The "Packaged foods" group under the everyday results (step 223): brand-name products, shown only when there are some.
  const [packagedHits, setPackagedHits] = useState<PackagedHit[]>([]);
  // The words searched instead of the ones typed, when what was typed found nothing and a likely spelling did (step 226): "Showing results for chicken breast".
  const [correctedTo, setCorrectedTo] = useState<string | null>(null);
  // The likely spelling when what was typed found something anyway (a misspelling printed on a few products): "Did you mean avocado?", a tap searches it.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // What was picked: the name shown big (the plain name, or the brand and product), USDA's own name small under it, and, for a packaged food, its code (it is logged as a barcode food).
  const [picked, setPicked] = useState<{ title: string; usdaName: string | null; packaged: { barcode: string | null } | null } | null>(null);
  const seq = useRef(0);

  // Search as the person types (after a short pause); the latest search wins. The everyday foods and the packaged ones are read at the same time; a packaged search that fails simply
  // shows no packaged group (the everyday results are the search). When both find nothing, the likely spelling is tried once (lib/food-search-run.ts, step 226).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      setPackagedHits([]);
      setCorrectedTo(null);
      setSuggestion(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const found = await runFoodSearch(createBrowserClient(), q);
      if (mine !== seq.current) return;
      setSearchFailed(found.hits === null);
      setHits(found.hits ?? []);
      setPackagedHits(found.packaged);
      setCorrectedTo(found.correctedTo);
      setSuggestion(found.suggestion);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  // A drink labelled by volume is measured in ml (its servings, then ml), never in grams.
  const options = useMemo(() => (detail?.per100Unit === "ml" ? mlServingOptions(detail.portions) : servingOptions(detail?.portions ?? [])), [detail]);
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
    setPicked({ title: hit.plainName || d.description, usdaName: hit.plainName ? d.description : null, packaged: null });
    setOptionKey(start.option.key);
    setQtyText(String(start.qty));
  }

  // A packaged food carries everything it needs in the hit itself (no read).
  function pickPackaged(hit: PackagedHit) {
    setError(null);
    setAdded(null);
    const d = packagedDetail(hit);
    const start = defaultServing(d.per100Unit === "ml" ? mlServingOptions(d.portions) : servingOptions(d.portions));
    setDetail(d);
    setPicked({ title: d.description, usdaName: null, packaged: { barcode: hit.gtinUpc } });
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
      // logged under the name shown (the plain name, or the brand and product); USDA's own name stays on the food
      description: picked?.title ?? detail.description,
      servingLabel: option.label,
      servingQty: qty,
      grams,
      per100g: detail.per100g,
      packaged: picked?.packaged ?? null,
      amountInMl: detail.per100Unit === "ml",
    });
    setSaving(false);
    if (!entry) {
      setError("That didn't save. Try again.");
      return;
    }
    onLogged(entry);
    setAdded(`${picked?.title ?? detail.description} added to ${MEAL_SLOT_LABEL[slot].toLowerCase()}.`);
    setDetail(null);
    setPicked(null);
    setQuery("");
    setHits(null);
    setPackagedHits([]);
    setCorrectedTo(null);
    setSuggestion(null);
  }

  if (!open) {
    return (
      // One big bar (Look Refresh, Nov 20): the first way to log on the page.
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[44px] h-[52px] px-5 rounded-token-pill bg-surface-2 border border-rust/30 flex items-center gap-2.5 text-left font-body text-[15px] font-medium text-chalk active:border-rust transition-colors"
      >
        <Search className="w-5 h-5 text-rust-ink shrink-0" aria-hidden="true" />
        Search foods
      </button>
    );
  }

  return (
    <div className={inSheet ? "" : "bg-surface rounded-card p-3"} data-testid="food-search">
      {!inSheet && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="font-body text-[13px] font-semibold text-steel">Search foods</p>
          <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-2 font-body text-xs text-steel">
            Close
          </button>
        </div>
      )}

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
            className="w-full min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk placeholder:text-steel"
          />
          {added && <p className="font-body text-xs text-rust-ink mt-2">{added}</p>}
          {searching && <p className="font-body text-xs text-steel mt-2">Searching…</p>}
          {!searching && searchFailed && (
            <p className="font-body text-xs text-rust-ink mt-2" role="alert">
              Couldn&apos;t search just now. Check your connection and try again.
            </p>
          )}
          {!searching && !searchFailed && hits && hits.length === 0 && packagedHits.length === 0 && (
            <p className="font-body text-xs text-steel mt-2">No foods found for that. Try a simpler word, like &quot;chicken&quot; instead of &quot;grilled chicken&quot;.</p>
          )}
          {/* what was typed found nothing; these are the results for the likely spelling (step 226) */}
          {!searching && correctedTo && ((hits && hits.length > 0) || packagedHits.length > 0) && (
            <p className="font-body text-xs text-steel mt-2" data-corrected-query>
              Showing results for <strong className="font-semibold text-chalk">{correctedTo}</strong>
            </p>
          )}
          {/* what was typed found something, but a word looks misspelled: the likely spelling, a tap searches it (step 226) */}
          {!searching && !correctedTo && suggestion && ((hits && hits.length > 0) || packagedHits.length > 0) && (
            <button type="button" onClick={() => setQuery(suggestion)} className="mt-1 min-h-[44px] text-left font-body text-xs text-steel" data-did-you-mean>
              Did you mean <strong className="font-semibold text-rust-ink underline underline-offset-2">{suggestion}</strong>?
            </button>
          )}
          {((hits && hits.length > 0) || packagedHits.length > 0) && (
            <div className="mt-2 border border-steel/15 max-h-80 overflow-y-auto" data-food-results>
              {hits && hits.length > 0 && (
                <ul className="divide-y divide-steel/15">
                  {hits.map((h) => (
                    <li key={h.fdcId}>
                      <button type="button" onClick={() => pick(h)} disabled={loadingDetail} className="w-full text-left px-3 py-2 min-h-[44px] disabled:opacity-60">
                        {/* the name a person says big, USDA's own name small under it (step 223) */}
                        <span className="block font-body text-sm text-chalk">{h.plainName || h.description}</span>
                        {h.plainName && <span className="block font-body text-xs text-steel" data-usda-name>{h.description}</span>}
                        <span className="block font-body text-xs text-steel [font-variant-numeric:tabular-nums]">{per100Line(h.per100g)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* Brand-name products, below the everyday foods, only when there are some (step 223) */}
              {packagedHits.length > 0 && (
                <section aria-label="Packaged foods" data-packaged-foods>
                  <p className="px-3 pt-3 pb-1 font-body text-xs font-semibold text-steel uppercase tracking-wide border-t border-steel/15">Packaged foods</p>
                  <ul className="divide-y divide-steel/15">
                    {packagedHits.map((p) => (
                      <li key={`packaged-${p.fdcId}`}>
                        <button type="button" onClick={() => pickPackaged(p)} disabled={loadingDetail} className="w-full text-left px-3 py-2 min-h-[44px] disabled:opacity-60">
                          <span className="block font-body text-sm text-chalk">{packagedTitle(p)}</span>
                          <span className="block font-body text-xs text-steel [font-variant-numeric:tabular-nums]">{per100Line(p.per100g, p.servingSizeUnit === "ml" ? "ml" : "g")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
          {loadingDetail && <p className="font-body text-xs text-steel mt-2">Loading…</p>}
        </>
      )}

      {detail && option && (
        <div>
          <button
            type="button"
            onClick={() => {
              setDetail(null);
              setPicked(null);
            }}
            className="min-h-[44px] font-body text-xs text-steel"
          >
            &larr; Back to results
          </button>
          <p className="font-body text-sm text-chalk">{picked?.title ?? detail.description}</p>
          {picked?.usdaName && <p className="font-body text-xs text-steel">{picked.usdaName}</p>}

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

          {problem && <p className="font-body text-xs text-rust-ink mt-2" role="alert">{problem}</p>}
          {grams != null && <p className="font-body text-xs text-steel mt-2">That is {detail.per100Unit === "ml" ? `${grams} ml` : formatAmount(grams)}.</p>}

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

      {error && <p className="font-body text-xs text-rust-ink mt-2" role="alert">{error}</p>}
    </div>
  );
}
