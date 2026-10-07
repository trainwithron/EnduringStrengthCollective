// The coach's typed note ("no dairy, peanut allergy, hates mushrooms, vegetarian") as food rules. The planner's note field used to pick only the diet and the macro split; the
// library-first builder reads rules, so the note is turned into rules here and MERGED with the client's saved ones. An allergen group the note names becomes an ALLERGY (the safe
// side: a hard drop), a diet word sets the diet, and any other food named becomes a dislike. Nothing here is saved: it only shapes the meals offered in this build.
import { ALLERGEN_KEYS, allergyKeysOf, textHasAllergen, type FoodRules } from "@/lib/allergen-check";

export interface TypedRules {
  allergies: string[];
  dislikes: string[];
  dietType: string | null;
}

const DIET_WORDS: [RegExp, string][] = [
  [/\bvegan\b/, "vegan"],
  [/\bvegetarian\b/, "vegetarian"],
  [/\bpesc(?:a|e)tarian\b/, "pescatarian"],
  [/\bketo\b/, "keto"],
  [/\bpaleo\b/, "paleo"],
  [/\bcarnivore\b/, "carnivore"],
];

const FILLER = /^(?:none|n\/a|na|nothing|restrictions?|allergies|allergy|preferences?|omnivore|eats everything|normal|no|n|a)$/;
const LEAD = /^(?:no|without|avoid(?:s|ing)?|allergic to|allergy to|allergies to|allergies|allergy|intolerant to|doesn'?t eat|does not eat|dont eat|don'?t eat|hates?|dislikes?|can'?t have|cannot have|cant have|free of)\s+/;
const TRAIL = /\s+(?:allergy|allergies|intolerant|intolerance|free)$/;

export function rulesFromTypedText(text: string | null | undefined): TypedRules {
  const out: TypedRules = { allergies: [], dislikes: [], dietType: null };
  const lower = (text ?? "").toLowerCase();
  if (!lower.trim()) return out;
  for (const [re, diet] of DIET_WORDS) if (re.test(lower)) { out.dietType = diet; break; }
  const allergies = new Set<string>();
  const dislikes = new Set<string>();
  for (const raw of lower.split(/[,;\n]|\band\b|&|\/|\bor\b/)) {
    let frag = raw.replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
    // A leading word can repeat ("no no dairy"); strip until nothing more comes off.
    for (let i = 0; i < 3; i++) frag = frag.replace(LEAD, "");
    frag = frag.replace(TRAIL, "").trim();
    if (!frag || FILLER.test(frag)) continue;
    // A fragment that is only a diet word was handled above.
    if (DIET_WORDS.some(([re]) => re.test(frag) && frag.split(" ").length === 1)) continue;
    const keys: string[] = [...new Set([...allergyKeysOf([frag]), ...ALLERGEN_KEYS.filter((k) => textHasAllergen(frag, k) !== null)])];
    if (keys.length > 0) {
      keys.forEach((k) => allergies.add(k));
      continue;
    }
    if (frag.length >= 3 && frag.length <= 40) dislikes.add(frag);
  }
  out.allergies = [...allergies];
  out.dislikes = [...dislikes];
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

// The client's saved rules plus what the coach typed. Allergies and dislikes are unions; the saved diet wins unless it is the default (omnivore or unset).
export function mergeRules(saved: FoodRules | undefined, typed: TypedRules): FoodRules {
  const own = saved?.dietType && saved.dietType !== "omnivore" ? saved.dietType : null;
  return {
    allergies: uniq([...(saved?.allergies ?? []), ...typed.allergies]),
    intolerances: saved?.intolerances ?? [],
    dislikes: uniq([...(saved?.dislikes ?? []), ...typed.dislikes]),
    dietType: own ?? typed.dietType ?? saved?.dietType ?? null,
  };
}

// Plain words for what was understood, shown under the note field.
export function describeTypedRules(t: TypedRules): string {
  const parts: string[] = [];
  if (t.allergies.length > 0) parts.push(`${t.allergies.join(", ")} (never offered)`);
  if (t.dislikes.length > 0) parts.push(`avoids ${t.dislikes.join(", ")}`);
  if (t.dietType) parts.push(`${t.dietType} diet`);
  return parts.join(" · ");
}

// What the note adds beyond the saved rules (so the coach can be told to save it).
export function newFromTyped(saved: FoodRules | undefined, typed: TypedRules): boolean {
  const has = (list: string[] | undefined, v: string) => (list ?? []).some((x) => x.toLowerCase() === v.toLowerCase());
  return typed.allergies.some((a) => !has(saved?.allergies, a)) || typed.dislikes.some((d) => !has(saved?.dislikes, d)) || (!!typed.dietType && typed.dietType !== saved?.dietType);
}
