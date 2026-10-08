// Saving an approved AI option into the coach's private recipe library. No AI call happens here: the option was already generated and verified (every line matched to a real
// food with real macros). This turns it into the rows the library reads, with the tags worked out from what is in it, a fingerprint so the same option saved twice is one recipe,
// and reference grams on every measured line so the builder can scale it to any slot (lib/library-scaling.ts).
import { ALLERGEN_KEYS, checkLines, textHasAllergen } from "@/lib/allergen-check";
import type { MealOption } from "@/lib/meal-engine";
import { mainProteinOf } from "@/lib/main-protein";
import type { DietType, Slot } from "@/lib/meal-templates/types";

export interface AiRecipeRows {
  recipe: {
    name: string;
    slot: Slot;
    archetypes: DietType[];
    keywords: string[];
    source: "ai";
    visibility: "private";
    allergens: string[];
    intolerance_tags: string[];
    diet_tags: string[];
    main_protein: string | null;
    reference_macros: { protein: number; carbs: number; fat: number; kcal: number };
    verified_at: string;
    content_hash: string;
  };
  ingredients: {
    sort_order: number;
    label: string;
    role: "protein_source" | "carb_source" | "fat_source" | "fixed";
    protein_per_100g: number;
    carbs_per_100g: number;
    fat_per_100g: number;
    fixed_display_text: string | null;
    usda_fdc_id: number | null;
    grams_ref: number | null;
  }[];
}

export type AiRecipeResult = { ok: true; rows: AiRecipeRows } | { ok: false; reason: string };

// A line that adds almost nothing (a handful of spinach) is kept as a text line: it is shown, not scaled.
const NEGLIGIBLE_KCAL = 20;
const round1 = (n: number) => Math.round(n * 10) / 10;

function roleOf(p: number, c: number, f: number): "protein_source" | "carb_source" | "fat_source" {
  if (p >= 12) return "protein_source";
  if (c >= 12) return "carb_source";
  if (f >= 15) return "fat_source";
  const biggest = Math.max(p, c, f);
  return biggest === p ? "protein_source" : biggest === c ? "carb_source" : "fat_source";
}

const cleanName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// SHA-256 of the recipe's lines, as 64 lower-case hex characters. The same foods in the same amounts give the same fingerprint whatever the AI called the recipe.
export async function contentHashOf(lines: { label: string; grams: number | null }[]): Promise<string> {
  const text = lines
    .map((l) => `${cleanName(l.label)}|${l.grams === null ? "" : Math.round(l.grams)}`)
    .sort()
    .join("\n");
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Library meals are offered to the coach's OTHER clients, so nothing about the client they were made for may travel with them. The AI is never given the client's name, but the coach's
// typed notes can contain it and the model can echo a note back, so the client's name is taken out of the recipe's name and a meal whose lines mention it is not saved.
// A word as a name would be matched: lower case, with surrounding punctuation and a possessive 's taken off.
const core = (w: string): string => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/'s$/, "");
const nameSet = (words: string[]): Set<string> => new Set(words.map(core).filter((w) => w.length >= 3));
// The words of a client's name to keep out of a library meal: split on spaces and hyphens ("Mary-Ann Lee" gives Mary, Ann, Lee), words under 3 letters dropped.
export function clientWordsOf(name: string | null | undefined): string[] {
  return (name ?? "")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

export function mentionsAny(text: string, words: string[]): boolean {
  const names = nameSet(words);
  return names.size > 0 && text.split(/[ \t\n,;:()/]+/).some((tok) => names.has(core(tok)));
}
export function scrubWords(text: string, words: string[]): string {
  const names = nameSet(words);
  if (names.size === 0) return text;
  return text
    .split(/( +)/)
    .filter((tok) => !names.has(core(tok)))
    .join("")
    .replace(/ {2,}/g, " ")
    .replace(/^[ ,:;-]+|[ ,:;-]+$/g, "")
    .trim();
}

export async function buildAiRecipeRows(option: MealOption, slot: Slot, now: Date = new Date(), opts: { clientWords?: string[] } = {}): Promise<AiRecipeResult> {
  const clientWords = opts.clientWords ?? [];
  if (!option.isAi || !option.aiLines || option.aiLines.length === 0) return { ok: false, reason: "Only a verified AI option can be saved to the library." };
  if (!option.verifiedMacros) return { ok: false, reason: "This option has no verified macros, so it cannot be saved." };
  const ingredients: AiRecipeRows["ingredients"] = [];
  const weighted: { name: string; proteinG: number }[] = [];
  let order = 0;
  for (const line of option.aiLines) {
    const label = (line.name ?? line.rawLine).trim();
    const grams = line.grams;
    const p = line.proteinG ?? 0;
    const c = line.carbsG ?? 0;
    const f = line.fatG ?? 0;
    const kcal = 4 * p + 4 * c + 9 * f;
    if (grams === null || !(grams > 0) || kcal < NEGLIGIBLE_KCAL) {
      ingredients.push({ sort_order: order++, label, role: "fixed", protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 0, fixed_display_text: line.rawLine, usda_fdc_id: null, grams_ref: null });
      continue;
    }
    if (line.fdcId === null || line.fdcId === undefined) return { ok: false, reason: `"${label}" is not matched to a real food, so this option cannot be saved.` };
    if (grams > 2000) return { ok: false, reason: `"${label}" is over 2000 g, so this option cannot be saved.` };
    const per = (n: number) => round1((n / grams) * 100);
    ingredients.push({
      sort_order: order++,
      label,
      role: roleOf(per(p), per(c), per(f)),
      protein_per_100g: per(p),
      carbs_per_100g: per(c),
      fat_per_100g: per(f),
      fixed_display_text: null,
      usda_fdc_id: line.fdcId,
      grams_ref: Math.round(grams),
    });
    weighted.push({ name: label, proteinG: p });
  }
  if (!ingredients.some((i) => i.role !== "fixed")) return { ok: false, reason: "This option has no measured line to scale, so it cannot be saved." };
  if (clientWords.length > 0 && option.aiLines.some((l) => mentionsAny(`${l.rawLine} ${l.name ?? ""}`, clientWords))) return { ok: false, reason: "This meal's lines mention the client by name, so it was not added to your library." };
  const cleanedName = clientWords.length > 0 ? scrubWords(option.recipeName ?? "", clientWords) : (option.recipeName ?? "");

  // Tags are worked out from the name, the matched food AND the line as the AI wrote it, so a label that hides the food cannot hide an allergen.
  const text = [option.recipeName ?? "", ...ingredients.map((i) => i.label), ...option.aiLines.map((l) => l.rawLine), ...ingredients.map((i) => i.fixed_display_text ?? "")].filter(Boolean);
  const allergens = ALLERGEN_KEYS.filter((k) => text.some((t) => textHasAllergen(t, k) !== null));
  // Diets the lines clearly fit. Omnivore always; the meat-free ones only when the same rules the client screens use find nothing in the lines.
  const diets: DietType[] = ["omnivore"];
  for (const d of ["pescatarian", "vegetarian", "vegan"] as const) if (checkLines(text, { dietType: d }).length === 0) diets.push(d);
  const m = option.verifiedMacros;
  return {
    ok: true,
    rows: {
      recipe: {
        name: (cleanedName || "AI meal").slice(0, 120),
        slot,
        archetypes: diets,
        keywords: [...new Set(ingredients.filter((i) => i.role !== "fixed").map((i) => cleanName(i.label).split(" ")[0]))].slice(0, 8),
        source: "ai",
        visibility: "private",
        allergens,
        intolerance_tags: [],
        diet_tags: diets,
        main_protein: mainProteinOf(weighted),
        reference_macros: { protein: round1(m.protein), carbs: round1(m.carbs), fat: round1(m.fat), kcal: Math.round(m.kcal) },
        verified_at: now.toISOString(),
        content_hash: await contentHashOf(ingredients.filter((i) => i.role !== "fixed").map((i) => ({ label: i.label, grams: i.grams_ref }))),
      },
      ingredients,
    },
  };
}
