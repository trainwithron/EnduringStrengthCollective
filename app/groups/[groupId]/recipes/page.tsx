import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { RecipeHubManager, type RecipeRow } from "@/components/coach/desktop/recipe-hub-manager";

export default async function RecipeHubPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
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
      "id, name, slot, archetypes, keywords, recipe_ingredients ( id, sort_order, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text )"
    )
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

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
      })),
  }));

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
    </CoachDesktopShell>
  );
}
