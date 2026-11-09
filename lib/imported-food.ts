// Food history a coach brought in from another app (Cronometer, MyFitnessPal, MacroFactor) is HISTORY ONLY. It is stored in food_log_entries like any other food, marked with
// food_source = 'import' (migration 0446), so the day views and the "what they ate" charts show it. It never counts as the client logging: not in the days-logged count of the
// weekly check-in, the coach's "This week" table, the 7-day food view, the phase review, or the recent foods offered for one-tap logging.

export const IMPORTED_FOOD_SOURCE = "import";

// A PostgREST filter that keeps every row that is NOT imported. A plain neq would also drop the rows with no food_source at all (most of them: null <> 'import' is not true),
// so it is "no source, or a source other than import". Use it as .or(NOT_IMPORTED) on any read that counts or credits logging.
export const NOT_IMPORTED = `food_source.is.null,food_source.neq.${IMPORTED_FOOD_SOURCE}`;

export function isImportedFood(entry: { foodSource?: string | null; food_source?: string | null }): boolean {
  return (entry.foodSource ?? entry.food_source ?? null) === IMPORTED_FOOD_SOURCE;
}

// When the client copies an imported food to another day, or saves it into a meal, the copy is something they really logged now: it does not carry the import mark.
export function liveFoodSource(source: string | null | undefined): string | null {
  return source == null || source === IMPORTED_FOOD_SOURCE ? null : source;
}
