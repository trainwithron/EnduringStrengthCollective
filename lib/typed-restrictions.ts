// The coach's typed note ("no dairy, peanut allergy, hates mushrooms, vegetarian") as food rules. The planner's note field used to pick only the diet and the macro split; the
// library-first builder reads rules, so the note is turned into rules here and MERGED with the client's saved ones. An allergen group the note names becomes an ALLERGY (the safe
// side: a hard drop), a diet word sets the diet, and any other food named becomes a dislike. Nothing here is saved: it only shapes the meals offered in this build.
import { ALLERGEN_KEYS, allergyKeysOf, textHasAllergen, type FoodRules } from "@/lib/allergen-check";

export interface TypedRules {
  allergies: string[];
  dislikes: string[];
  dietType: string | null;
  // Foods the note says the client LIKES ("loves cheese"): these only boost a meal, they are never a restriction.
  likes: string[];
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
// Positive wording: what the client likes, not a restriction.
const LIKE_LEAD = /^(?:likes?|loves?|enjoys?|prefers?|favou?rites?|favou?rite|fond of|wants?|craves?)\b\s*/;
const TRAIL = /\s+(?:allergy|allergies|intolerant|intolerance|free)$/;

export function rulesFromTypedText(text: string | null | undefined): TypedRules {
  const out: TypedRules = { allergies: [], dislikes: [], dietType: null, likes: [] };
  const lower = (text ?? "").toLowerCase();
  if (!lower.trim()) return out;
  const allergies = new Set<string>();
  const dislikes = new Set<string>();
  const likes = new Set<string>();
  for (const raw of lower.split(/[,;\n]|\band\b|&|\/|\bor\b/)) {
    let frag = raw.replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
    // "likes eggs, loves cheese" is wording about what they enjoy: it boosts, it never restricts.
    if (LIKE_LEAD.test(frag)) {
      const liked = frag.replace(LIKE_LEAD, "").trim();
      if (liked.length >= 3 && liked.length <= 40) likes.add(liked);
      continue;
    }
    // A diet word (not inside a "likes ..." fragment): the stricter one wins if several are named.
    for (const [re, diet] of DIET_WORDS) {
      if (re.test(frag)) {
        if (strictness(diet) > strictness(out.dietType) || out.dietType === null) out.dietType = diet;
        break;
      }
    }
    // A leading word can repeat ("no no dairy"); strip until nothing more comes off.
    for (let i = 0; i < 3; i++) frag = frag.replace(LEAD, "");
    frag = frag.replace(TRAIL, "").trim();
    if (!frag || FILLER.test(frag)) continue;
    // "no animal products" is a vegan diet; "no meat" is the meat group (poultry and red meat, not fish), handled below as a group dislike.
    if (/^animal products?$/.test(frag)) {
      out.dietType = "vegan";
      continue;
    }
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
  out.likes = [...likes];
  return out;
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

// How strict a diet is: only the three meat-free diets are enforced line by line, and vegan is stricter than vegetarian, which is stricter than pescatarian. Anything else
// (keto, paleo, carnivore, omnivore) is a style of eating, not a filter on the lines.
const STRICTNESS: Record<string, number> = { vegan: 3, vegetarian: 2, pescatarian: 1 };
const strictness = (d: string | null | undefined) => (d ? STRICTNESS[d] ?? 0 : 0);

// The client's saved rules plus what the coach typed. Allergies and dislikes are unions. The diet is the STRICTER of the two (a note can tighten a saved rule, never relax it);
// on a tie, or when neither is a meat-free diet, the saved diet wins and a typed one only fills in when nothing is saved.
export function mergeRules(saved: FoodRules | undefined, typed: TypedRules): FoodRules {
  const own = saved?.dietType && saved.dietType !== "omnivore" ? saved.dietType : null;
  const dietType = strictness(typed.dietType) > strictness(own) ? typed.dietType : own ?? typed.dietType ?? saved?.dietType ?? null;
  return {
    allergies: uniq([...(saved?.allergies ?? []), ...typed.allergies]),
    intolerances: saved?.intolerances ?? [],
    dislikes: uniq([...(saved?.dislikes ?? []), ...typed.dislikes]),
    dietType,
  };
}

// Plain words for what was understood, shown under the note field.
export function describeTypedRules(t: TypedRules): string {
  const parts: string[] = [];
  if (t.allergies.length > 0) parts.push(`${t.allergies.join(", ")} (never offered)`);
  if (t.dislikes.length > 0) parts.push(`avoids ${t.dislikes.join(", ")}`);
  if (t.dietType) parts.push(`${t.dietType} diet`);
  if (t.likes.length > 0) parts.push(`likes ${t.likes.join(", ")}`);
  return parts.join(" · ");
}

// What the note adds beyond the saved rules (so the coach can be told to save it).
export function newFromTyped(saved: FoodRules | undefined, typed: TypedRules): boolean {
  const has = (list: string[] | undefined, v: string) => (list ?? []).some((x) => x.toLowerCase() === v.toLowerCase());
  return typed.allergies.some((a) => !has(saved?.allergies, a)) || typed.dislikes.some((d) => !has(saved?.dislikes, d)) || (!!typed.dietType && typed.dietType !== saved?.dietType);
}
