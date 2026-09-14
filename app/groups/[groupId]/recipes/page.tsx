import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { RecipeHubManager, type RecipeRow } from "@/components/coach/desktop/recipe-hub-manager";
import { BuiltinIngredientMappings } from "@/components/coach/desktop/builtin-ingredient-mappings";
import { ALL_BUILTIN_INGREDIENT_KEYS, getBuiltinIngredientLabel } from "@/lib/builtin-recipe-ingredients";

export default async function RecipeHubPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can manage the recipe hub.
        </p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: recipeRows } = await supabase
    .from("recipes")
    .select(
      "id, name, slot, archetypes, keywords, recipe_ingredients ( id, sort_order, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text, usda_fdc_id )"
    )
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  const mappedFdcIds = Array.from(
    new Set(
      (recipeRows ?? []).flatMap((r: any) =>
        (r.recipe_ingredients ?? []).map((i: any) => i.usda_fdc_id).filter((id: number | null) => id != null)
      )
    )
  );
  const { data: usdaFoodRows } = mappedFdcIds.length
    ? await supabase.from("usda_foods").select("fdc_id, description").in("fdc_id", mappedFdcIds)
    : { data: [] as { fdc_id: number; description: string }[] };
  const usdaDescriptionByFdcId = new Map((usdaFoodRows ?? []).map((f) => [f.fdc_id, f.description]));

  const recipes: RecipeRow[] = (recipeRows ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    slot: r.slot,
    archetypes: r.archetypes ?? [],
    keywords: r.keywords ?? [],
    ingredients: (r.recipe_ingredients ?? [])
      .slice()
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((i: any) => ({
        id: i.id,
        sortOrder: i.sort_order,
        label: i.label,
        role: i.role,
        proteinPer100g: i.protein_per_100g,
        carbsPer100g: i.carbs_per_100g,
        fatPer100g: i.fat_per_100g,
        fixedDisplayText: i.fixed_display_text,
        usdaFdcId: i.usda_fdc_id,
        usdaDescription: i.usda_fdc_id ? usdaDescriptionByFdcId.get(i.usda_fdc_id) ?? null : null,
      })),
  }));

  const { data: builtinMappingRows } = await supabase
    .from("builtin_ingredient_usda_mappings")
    .select("ingredient_key, usda_fdc_id");
  const builtinMappingByKey = new Map((builtinMappingRows ?? []).map((r) => [r.ingredient_key, r.usda_fdc_id]));
  const builtinFdcIds = Array.from(new Set(Array.from(builtinMappingByKey.values()).filter((id): id is number => id != null)));
  const { data: builtinUsdaFoodRows } = builtinFdcIds.length
    ? await supabase.from("usda_foods").select("fdc_id, description").in("fdc_id", builtinFdcIds)
    : { data: [] as { fdc_id: number; description: string }[] };
  const builtinDescriptionByFdcId = new Map((builtinUsdaFoodRows ?? []).map((f) => [f.fdc_id, f.description]));

  const builtinRows = ALL_BUILTIN_INGREDIENT_KEYS.map((key) => {
    const fdcId = builtinMappingByKey.get(key) ?? null;
    return {
      key,
      label: getBuiltinIngredientLabel(key),
      usdaFdcId: fdcId,
      usdaDescription: fdcId ? builtinDescriptionByFdcId.get(fdcId) ?? null : null,
    };
  });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="recipes">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Recipe Hub</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Your own recipes, built from real ingredients — each one scales automatically to hit
          whatever protein/carb/fat target a client&apos;s meal plan calls for, right alongside the
          built-in recipe database in the Meal Planner.
        </p>
      </div>

      <RecipeHubManager initialRecipes={recipes} />

      <div className="pt-8 mt-8 border-t border-steel/20">
        <h2 className="font-display font-bold text-xl uppercase leading-none mb-2">
          Built-In Recipe Ingredients
        </h2>
        <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">
          Map the 24 built-in recipes&apos; shared ingredient list to real USDA foods so every
          client&apos;s Key nutrients grid can estimate real micronutrients, not just macros. Shared
          across every coach on the platform.
        </p>
        <BuiltinIngredientMappings initialRows={builtinRows} />
      </div>
    </CoachDesktopShell>
  );
}
