"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { UsdaFoodPicker } from "./usda-food-picker";

export interface BuiltinIngredientMappingRow {
  key: string;
  label: string;
  usdaFdcId: number | null;
  usdaDescription: string | null;
}

// The 24 built-in RECIPE_DATABASE recipes' shared ingredient vocabulary
// (lib/builtin-recipe-ingredients.ts) — global, not per-coach, since it's
// shared platform code. Any coach can correct a mapping; changes apply
// to every group's Key nutrients grid immediately.
export function BuiltinIngredientMappings({ initialRows }: { initialRows: BuiltinIngredientMappingRow[] }) {
  const [rows, setRows] = useState(initialRows);

  async function handlePicked(key: string, fdcId: number | null, description: string | null) {
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("builtin_ingredient_usda_mappings").upsert({
      ingredient_key: key,
      usda_fdc_id: fdcId,
      mapped_by: userData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, usdaFdcId: fdcId, usdaDescription: description } : r)));
  }

  const mappedCount = rows.filter((r) => r.usdaFdcId).length;

  return (
    <div>
      <p className="font-body text-sm text-steel mb-3">
        {mappedCount}/{rows.length} mapped — these power the Key nutrients estimate for every
        built-in recipe across every coach&apos;s clients.
      </p>
      <div className="border border-steel/20 divide-y divide-steel/15">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[1fr_2fr] gap-3 items-center p-2.5">
            <span className="font-body text-sm text-chalk">{row.label}</span>
            <UsdaFoodPicker
              currentFdcId={row.usdaFdcId}
              currentDescription={row.usdaDescription}
              onPicked={(fdcId, description) => handlePicked(row.key, fdcId, description)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
