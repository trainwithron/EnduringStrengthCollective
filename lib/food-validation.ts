// Sanity checks for numbers a person types in for a food: editing a logged entry now, and creating a custom food or a label in phase 2. Errors stop the save; warnings are shown
// and the person may still save (labels round, alcohol and fibre do not follow 4/4/9 exactly).

export interface MacroInput {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface MacroCheck {
  errors: string[];
  warnings: string[];
}

// The most one entry can sensibly be (a whole day's food in one go is still under these). The database has looser outer limits (20,000 kcal).
export const MAX_ENTRY_CALORIES = 6000;
export const MAX_ENTRY_PROTEIN_G = 500;
export const MAX_ENTRY_CARBS_G = 1000;
export const MAX_ENTRY_FAT_G = 500;

const bad = (n: number | null) => n != null && (!Number.isFinite(n) || n < 0);

export function checkMacros(input: MacroInput): MacroCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { calories, proteinG, carbsG, fatG } = input;
  if (bad(calories) || bad(proteinG) || bad(carbsG) || bad(fatG)) errors.push("Numbers can't be negative.");
  if (calories == null) errors.push("Enter the calories.");
  if (errors.length > 0) return { errors, warnings };
  if (calories! > MAX_ENTRY_CALORIES) errors.push(`That is more than ${MAX_ENTRY_CALORIES.toLocaleString("en-US")} calories for one entry. Check the number.`);
  if ((proteinG ?? 0) > MAX_ENTRY_PROTEIN_G) errors.push(`Protein is more than ${MAX_ENTRY_PROTEIN_G} g for one entry. Check the number.`);
  if ((carbsG ?? 0) > MAX_ENTRY_CARBS_G) errors.push(`Carbs are more than ${MAX_ENTRY_CARBS_G} g for one entry. Check the number.`);
  if ((fatG ?? 0) > MAX_ENTRY_FAT_G) errors.push(`Fat is more than ${MAX_ENTRY_FAT_G} g for one entry. Check the number.`);
  if (errors.length > 0) return { errors, warnings };

  // 4/4/9: only when all three macros are given.
  if (proteinG != null && carbsG != null && fatG != null) {
    const fromMacros = 4 * proteinG + 4 * carbsG + 9 * fatG;
    const gap = Math.abs(calories! - fromMacros);
    if (gap > Math.max(30, 0.2 * Math.max(calories!, fromMacros))) {
      warnings.push(`These numbers don't quite add up: ${Math.round(proteinG)} g protein, ${Math.round(carbsG)} g carbs and ${Math.round(fatG)} g fat come to about ${Math.round(fromMacros)} calories, not ${Math.round(calories!)}. Check them, or save as is.`);
    }
  }
  if (calories === 0 && ((proteinG ?? 0) > 0 || (carbsG ?? 0) > 0 || (fatG ?? 0) > 0)) warnings.push("Zero calories with some protein, carbs or fat. Check the calories.");
  return { errors, warnings };
}

// For a row built by multiplying servings: names the first number that is more than one entry can sensibly be, in plain words, or null when it all fits. The same ceilings as
// checkMacros; the database's outer limits are looser, so without this a very large number of servings fails the whole save with no explanation.
export function entryTooBigProblem(m: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }): string | null {
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  if ((m.calories ?? 0) > MAX_ENTRY_CALORIES) return `That comes to ${n(m.calories ?? 0)} calories for one entry. Check the servings.`;
  if ((m.proteinG ?? 0) > MAX_ENTRY_PROTEIN_G) return `That comes to ${n(m.proteinG ?? 0)} g of protein for one entry. Check the servings.`;
  if ((m.carbsG ?? 0) > MAX_ENTRY_CARBS_G) return `That comes to ${n(m.carbsG ?? 0)} g of carbs for one entry. Check the servings.`;
  if ((m.fatG ?? 0) > MAX_ENTRY_FAT_G) return `That comes to ${n(m.fatG ?? 0)} g of fat for one entry. Check the servings.`;
  return null;
}

// Parses what a person typed into a number, or null for empty. NaN for text that is not a number.
export function parseNumberField(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}
