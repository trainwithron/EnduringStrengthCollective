import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_BUILTIN_INGREDIENT_KEYS, getBuiltinIngredientLabel } from "@/lib/builtin-recipe-ingredients";
import type { BuiltinIngredientMappingRow } from "@/components/coach/desktop/builtin-ingredient-mappings";

// The built-in recipes' shared ingredients, each with the USDA food it is mapped to (or none), for the platform admin's page (app/admin/nutrition-ingredients). It used to be read
// inside a coach's Favorite meals tab (Ron, Nov 21: "I don't need to see that").
export async function loadBuiltinIngredientRows(supabase: SupabaseClient): Promise<BuiltinIngredientMappingRow[]> {
  const { data: mappingRows } = await supabase.from("builtin_ingredient_usda_mappings").select("ingredient_key, usda_fdc_id");
  const fdcByKey = new Map(((mappingRows ?? []) as { ingredient_key: string; usda_fdc_id: number | null }[]).map((r) => [r.ingredient_key, r.usda_fdc_id]));
  const fdcIds = Array.from(new Set(Array.from(fdcByKey.values()).filter((id): id is number => id != null)));
  const { data: foodRows } = fdcIds.length
    ? await supabase.from("usda_foods").select("fdc_id, description").in("fdc_id", fdcIds)
    : { data: [] as { fdc_id: number; description: string }[] };
  const descriptionByFdc = new Map(((foodRows ?? []) as { fdc_id: number; description: string }[]).map((f) => [f.fdc_id, f.description]));
  return ALL_BUILTIN_INGREDIENT_KEYS.map((key) => {
    const fdcId = fdcByKey.get(key) ?? null;
    return { key, label: getBuiltinIngredientLabel(key), usdaFdcId: fdcId, usdaDescription: fdcId ? (descriptionByFdc.get(fdcId) ?? null) : null };
  });
}
