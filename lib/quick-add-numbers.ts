import { entryTooBigProblem, parseNumberField } from "@/lib/food-validation";
import { trimDescription } from "@/lib/food-entry";

// "Just the numbers" in Log something else (Ron, Oct 20): calories, protein, carbs and fat typed straight in, with an optional name. One plain logged food. Pure, so the rules are tested.

export const QUICK_ADD_DEFAULT_NAME = "Quick add";

export interface QuickAddInput {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export interface QuickAddEntry {
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// The entry to save, or what to fix in plain words. Every number is 0 or more; at least the calories or one macro is filled in; an empty field stays empty (not 0).
export function quickAddEntry(input: QuickAddInput): { entry: QuickAddEntry } | { problem: string } {
  const calories = parseNumberField(input.calories);
  const proteinG = parseNumberField(input.protein);
  const carbsG = parseNumberField(input.carbs);
  const fatG = parseNumberField(input.fat);
  const all = [calories, proteinG, carbsG, fatG];
  if (all.some((n) => n != null && Number.isNaN(n))) return { problem: "Use numbers only." };
  if (all.some((n) => n != null && n < 0)) return { problem: "Numbers can't be negative." };
  if (all.every((n) => n == null)) return { problem: "Enter the calories or at least one of protein, carbs or fat." };
  const tooBig = entryTooBigProblem({ calories, proteinG, carbsG, fatG });
  if (tooBig) return { problem: tooBig.replace(" Check the servings.", " Check the number.") };
  const name = input.name.trim();
  return { entry: { description: trimDescription(name || QUICK_ADD_DEFAULT_NAME), calories, proteinG, carbsG, fatG } };
}
