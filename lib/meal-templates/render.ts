// The small renderer: turns a template's lines into the strings the client screens already show ("<strong>Name:</strong> amount"). The recipes write their own line
// text (their own label, a teaspoon conversion for butter, an ounce hint for meat), so rendering is a filter, not a rebuild.
import { isIngredient, type TemplateItem } from "./types";

// "(~6.3 oz)" for a weight in grams (imperial hint, as the old app printed it).
export function toOz(grams: number): string {
  return `(~${(grams / 28.3495).toFixed(1)} oz)`;
}

// Metric clients see no ounce hints (the old app's metric setting printed none).
export const stripOunceHints = (text: string): string => text.replace(/ ?\(~[0-9.]+ oz\)/g, "");

// The lines to SHOW, in order: preparation notes and every ingredient whose amount is worth showing. A blank line (an amount too small to show) is left out.
export function renderLines(items: TemplateItem[], opts: { metric?: boolean } = {}): string[] {
  return items
    .map((item) => item.text)
    .filter((t) => t.trim() !== "")
    .map((t) => (opts.metric ? stripOunceHints(t) : t));
}

// The ingredient lines that are part of the meal (shown and counted).
export const visibleIngredients = (items: TemplateItem[]) => items.filter(isIngredient).filter((i) => i.text.trim() !== "");
