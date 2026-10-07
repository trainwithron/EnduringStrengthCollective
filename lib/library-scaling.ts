// Scaling a coach's OWN saved recipe (or an approved AI option) to a slot's target. A recipe that carries reference grams on its lines (grams_ref) is scaled by ONE factor per
// role (protein sources together, carb sources together, fat sources together), so the proportions inside a role never change and the recipe stays itself. The factors are
// solved against all three macros at once (a protein source also carries fat, a carb source some protein), kept inside 0.4 to 2.5 times the reference, the amounts are rounded to
// what a person can weigh, and the real macros of what is printed are measured. A meal outside the tolerance for THIS target is skipped for it, never shown.
//
// A recipe saved before reference grams existed has none; it is scaled the way it always was (one adjustable line per macro, lib/recipe-scaling.ts), measured the same way, and
// held to the same tolerance.
import { caloriesOf, type Macros } from "@/lib/meal-templates/macros";
import { checkTolerance, type SlotTarget } from "@/lib/meal-templates/tolerance";
import type { DietType, Slot } from "@/lib/meal-templates/types";
import { formatIngredientLineHtml, scaleRecipe, type IngredientRole, type RecipeIngredientDef, type ScaledIngredientLine } from "@/lib/recipe-scaling";
import { mainProteinOf, proteinFamily } from "@/lib/main-protein";
import type { ScaledLine, ScaledMeal } from "@/lib/scaled-meal";

export const MIN_FACTOR = 0.4;
export const MAX_FACTOR = 2.5;

export interface LibraryLine {
  id: string;
  label: string;
  role: IngredientRole;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fixedDisplayText: string | null;
  usdaFdcId: number | null;
  // The line's reference grams (the recipe's own amount). Null on a recipe saved before the builder scaled by role.
  gramsRef: number | null;
  // The real food the line was matched to (the USDA description for usdaFdcId), filled in when the recipes are loaded. Only used to check the client's food rules.
  matchedDescription?: string | null;
}

export interface LibraryRecipe {
  id: string;
  name: string;
  // 'any' is a recipe that fits every slot.
  slot: Slot | "any";
  diets: DietType[];
  keywords: string[];
  lines: LibraryLine[];
  mainProtein: string | null;
  source: "coach" | "ai";
  // The allergen groups the recipe was tagged with when it was saved.
  allergens?: string[];
}

type Measured = Exclude<IngredientRole, "fixed">;
const MEASURED: Measured[] = ["protein_source", "carb_source", "fat_source"];
const PRIMARY: Record<Measured, "proteinG" | "carbsG" | "fatG"> = { protein_source: "proteinG", carb_source: "carbsG", fat_source: "fatG" };
const clamp = (n: number) => Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, n));

// Amounts a person can weigh: whole grams under 25 g, else the nearest 5 g (never zero).
export function practicalGrams(g: number): number {
  if (!(g > 0)) return 0;
  if (g < 25) return Math.max(1, Math.round(g));
  return Math.max(5, Math.round(g / 5) * 5);
}

const per100 = (l: LibraryLine) => ({ proteinG: l.proteinPer100g / 100, carbsG: l.carbsPer100g / 100, fatG: l.fatPer100g / 100 });

function macrosOfGrams(lines: LibraryLine[], gramsOf: (l: LibraryLine) => number): Macros {
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const l of lines) {
    if (l.role === "fixed") continue;
    const d = per100(l);
    const g = gramsOf(l);
    proteinG += g * d.proteinG;
    carbsG += g * d.carbsG;
    fatG += g * d.fatG;
  }
  return { proteinG, carbsG, fatG, calories: caloriesOf(proteinG, carbsG, fatG) };
}

// One factor per role present, solved so the macros land on the target. Each role is aimed at its own macro with the other roles' contribution already counted, passes repeat
// until the numbers stop moving (a protein source's fat is taken off the fat source, and so on). Exact when the system is well conditioned, closest-clamped when it is not.
export function solveFactors(lines: LibraryLine[], target: SlotTarget): Record<Measured, number> {
  const factors: Record<Measured, number> = { protein_source: 1, carb_source: 1, fat_source: 1 };
  const present = MEASURED.filter((r) => lines.some((l) => l.role === r && (l.gramsRef ?? 0) > 0));
  // The macro vector of each role at its reference grams.
  const vec: Record<Measured, { proteinG: number; carbsG: number; fatG: number }> = {
    protein_source: { proteinG: 0, carbsG: 0, fatG: 0 },
    carb_source: { proteinG: 0, carbsG: 0, fatG: 0 },
    fat_source: { proteinG: 0, carbsG: 0, fatG: 0 },
  };
  for (const l of lines) {
    if (l.role === "fixed") continue;
    const d = per100(l);
    const g = l.gramsRef ?? 0;
    const v = vec[l.role as Measured];
    v.proteinG += g * d.proteinG;
    v.carbsG += g * d.carbsG;
    v.fatG += g * d.fatG;
  }
  const want = { proteinG: target.proteinG, carbsG: target.carbsG, fatG: target.fatG };
  for (let pass = 0; pass < 80; pass++) {
    let moved = 0;
    for (const r of present) {
      const k = PRIMARY[r];
      const others = present.filter((o) => o !== r).reduce((s, o) => s + factors[o] * vec[o][k], 0);
      const own = vec[r][k];
      if (own <= 0) continue;
      const next = clamp((want[k] - others) / own);
      moved = Math.max(moved, Math.abs(next - factors[r]));
      factors[r] = next;
    }
    if (moved < 1e-6) break;
  }
  return factors;
}

function toMeal(recipe: LibraryRecipe, lines: LibraryLine[], gramsOf: (l: LibraryLine) => number | null, macros: Macros, displayLines: string[]): ScaledMeal {
  const scaledLines: ScaledLine[] = lines.map((l) => ({
    name: l.label,
    label: l.label,
    grams: l.role === "fixed" ? null : gramsOf(l),
    ...(l.matchedDescription ? { matched: l.matchedDescription } : {}),
  }));
  const weighted = lines
    .filter((l) => l.role !== "fixed")
    .map((l) => ({ name: l.label, proteinG: ((gramsOf(l) ?? 0) * l.proteinPer100g) / 100 }));
  return {
    key: `r:${recipe.id}`,
    source: recipe.source,
    recipeId: recipe.id,
    name: recipe.name,
    slot: recipe.slot === "any" ? "lunch" : recipe.slot,
    lines: scaledLines,
    displayLines,
    prepText: lines
      .filter((l) => l.role === "fixed" && l.fixedDisplayText)
      .map((l) => `${l.label}: ${l.fixedDisplayText}`)
      .join(" "),
    macros,
    mainProtein: recipe.mainProtein || mainProteinOf(weighted) || (weighted[0] ? proteinFamily(weighted[0].name) : null),
    drift: 0,
    ...(recipe.allergens && recipe.allergens.length > 0 ? { allergenTags: recipe.allergens } : {}),
  };
}

const ozOf = (g: number) => (g / 28.35).toFixed(1);

export function scaleLibraryRecipe(recipe: LibraryRecipe, slot: Slot, target: SlotTarget): ScaledMeal | null {
  const lines = recipe.lines;
  const measured = lines.filter((l) => l.role !== "fixed");
  if (measured.length === 0) return null;

  if (measured.every((l) => (l.gramsRef ?? 0) > 0)) {
    const f = solveFactors(lines, target);
    const grams = new Map(measured.map((l) => [l.id, practicalGrams((l.gramsRef as number) * f[l.role as Measured])]));
    const macros = macrosOfGrams(lines, (l) => grams.get(l.id) ?? 0);
    if (!checkTolerance(macros, target).ok) return null;
    const display = lines.map((l) =>
      l.role === "fixed"
        ? formatIngredientLineHtml({ ingredientId: l.id, label: l.label, role: l.role, grams: null, displayText: l.label, fixedDisplayText: l.fixedDisplayText })
        : `<strong>${l.label}:</strong> ${grams.get(l.id)}g (~${ozOf(grams.get(l.id) ?? 0)} oz)`
    );
    const meal = toMeal(recipe, lines, (l) => grams.get(l.id) ?? null, macros, display);
    return { ...meal, slot };
  }

  // A recipe saved before reference grams: the older one-line-per-macro scaling, measured and held to the same tolerance.
  const defs: RecipeIngredientDef[] = lines.map((l) => ({
    id: l.id,
    label: l.label,
    role: l.role,
    proteinPer100g: l.proteinPer100g,
    carbsPer100g: l.carbsPer100g,
    fatPer100g: l.fatPer100g,
    fixedDisplayText: l.fixedDisplayText,
    usdaFdcId: l.usdaFdcId,
  }));
  const scaled: ScaledIngredientLine[] = scaleRecipe(defs, { protein: target.proteinG, carbs: target.carbsG, fat: target.fatG });
  const gramsById = new Map(scaled.map((s) => [s.ingredientId, s.grams ?? 0]));
  const macros = macrosOfGrams(lines, (l) => gramsById.get(l.id) ?? 0);
  if (!checkTolerance(macros, target).ok) return null;
  const meal = toMeal(recipe, lines, (l) => gramsById.get(l.id) ?? null, macros, scaled.map(formatIngredientLineHtml));
  return { ...meal, slot };
}

// A database row (recipes with recipe_ingredients) as a LibraryRecipe. Soft on the new columns: a row read before the release has none of them.
export function libraryRecipeFromRow(r: Record<string, unknown>): LibraryRecipe | null {
  const rawLines = Array.isArray(r.recipe_ingredients) ? (r.recipe_ingredients as Record<string, unknown>[]) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
  const lines: LibraryLine[] = rawLines
    .slice()
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))
    .map((i) => ({
      id: String(i.id),
      label: String(i.label ?? ""),
      role: (["protein_source", "carb_source", "fat_source", "fixed"].includes(String(i.role)) ? i.role : "fixed") as IngredientRole,
      proteinPer100g: num(i.protein_per_100g),
      carbsPer100g: num(i.carbs_per_100g),
      fatPer100g: num(i.fat_per_100g),
      fixedDisplayText: typeof i.fixed_display_text === "string" ? i.fixed_display_text : null,
      usdaFdcId: typeof i.usda_fdc_id === "number" ? i.usda_fdc_id : null,
      gramsRef: i.grams_ref == null ? null : num(i.grams_ref) || null,
    }));
  if (typeof r.id !== "string" || typeof r.name !== "string" || lines.length === 0) return null;
  const slot = r.slot === "breakfast" || r.slot === "lunch" || r.slot === "dinner" || r.slot === "snack" ? r.slot : "any";
  const diets = (Array.isArray(r.archetypes) && r.archetypes.length > 0 ? r.archetypes : ["omnivore"]) as DietType[];
  return {
    id: r.id,
    name: r.name,
    slot,
    diets,
    keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
    lines,
    mainProtein: typeof r.main_protein === "string" && r.main_protein ? r.main_protein : null,
    source: r.source === "ai" ? "ai" : "coach",
    allergens: Array.isArray(r.allergens) ? (r.allergens as string[]) : [],
  };
}
