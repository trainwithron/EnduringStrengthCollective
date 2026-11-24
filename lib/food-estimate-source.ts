// The food_source of a food log row whose numbers are an estimate, not a database food (Nov 23, Spotters keep up): the typed quick-log when no food matched, and the photo log.
// 'ai' is one of the values the database allows (food_log_entries_food_source_check). It is for the coach-side reads and reports only: no client screen ever shows it.
export const FOOD_ESTIMATE_SOURCE = "ai" as const;

// The typed quick-log when every food in it was found in the USDA foods (everyday or packaged): the numbers are USDA's, scaled to the amount.
export const FOOD_DATABASE_SOURCE = "usda" as const;

export type QuickLogFoodSource = typeof FOOD_ESTIMATE_SOURCE | typeof FOOD_DATABASE_SOURCE;
