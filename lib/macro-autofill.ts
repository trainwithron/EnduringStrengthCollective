// Ron, Oct 21 (setting Johann's target): "it needs to automatically fill in the last blank. So I don't have to sit there and do the math." When a coach has typed three of calories, protein, carbs and
// fat, the fourth is worked out from them (4 kcal a gram of protein or carbs, 9 of fat), shown in a muted style, and recomputed as they type; typing into it makes it theirs. With all four typed and not adding
// up (more than 25 kcal apart), one quiet line says what they add up to. Nothing is blocked.
export type MacroKey = "calories" | "protein" | "carbs" | "fat";
export type MacroDraft = Record<MacroKey, string>;

export const MACRO_KEYS: readonly MacroKey[] = ["calories", "protein", "carbs", "fat"];
const KCAL_PER_GRAM: Record<Exclude<MacroKey, "calories">, number> = { protein: 4, carbs: 4, fat: 9 };
export const MISMATCH_KCAL = 25;
export const WORKED_OUT_NOTE = "worked out";

export interface MacroAutofill {
  /** The one blank field that was worked out, or null. */
  key: MacroKey | null;
  value: number | null;
  /** All four typed and more than 25 kcal apart: what protein, carbs and fat add up to. */
  mismatchTotal: number | null;
}

function num(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const kcalOf = (p: number, c: number, f: number) => p * 4 + c * 4 + f * 9;

export function macroAutofill(draft: MacroDraft): MacroAutofill {
  const blanks = MACRO_KEYS.filter((k) => draft[k].trim() === "");
  const values = Object.fromEntries(MACRO_KEYS.map((k) => [k, num(draft[k])])) as Record<MacroKey, number | null>;
  const none: MacroAutofill = { key: null, value: null, mismatchTotal: null };
  if (blanks.length === 0) {
    const { calories, protein, carbs, fat } = values;
    if (calories == null || protein == null || carbs == null || fat == null) return none;
    const total = Math.round(kcalOf(protein, carbs, fat));
    return Math.abs(total - calories) > MISMATCH_KCAL ? { ...none, mismatchTotal: total } : none;
  }
  if (blanks.length !== 1) return none;
  const key = blanks[0];
  // the other three must be real numbers
  if (MACRO_KEYS.some((k) => k !== key && values[k] == null)) return none;
  const v = values as Record<MacroKey, number>;
  if (key === "calories") return { ...none, key, value: Math.round(kcalOf(v.protein, v.carbs, v.fat)) };
  const others = MACRO_KEYS.filter((k): k is Exclude<MacroKey, "calories"> => k !== "calories" && k !== key).reduce((sum, k) => sum + v[k] * KCAL_PER_GRAM[k], 0);
  return { ...none, key, value: Math.max(0, Math.round((v.calories - others) / KCAL_PER_GRAM[key])) };
}

/** The four values with the worked-out one filled in: what is saved. */
export function withAutofill(draft: MacroDraft, fill: MacroAutofill = macroAutofill(draft)): MacroDraft {
  return fill.key && fill.value != null ? { ...draft, [fill.key]: String(fill.value) } : draft;
}

/** "These add up to 2,160 calories", or null. */
export function mismatchLine(fill: MacroAutofill): string | null {
  return fill.mismatchTotal == null ? null : `These add up to ${fill.mismatchTotal.toLocaleString("en-US")} calories`;
}
