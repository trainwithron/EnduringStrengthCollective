// "Meals logged: 2 of 4" for the Home card: how many of today's planned meals the client has checked off (eaten, changed or skipped all count:
// the point is that they engaged with the plan, not that every gram was exact).
export interface PlannedMealRef {
  spec: { id: string };
}

export interface LoggedEntryRef {
  mealSlot: string | null;
}

export function mealProgress(meals: PlannedMealRef[], entries: LoggedEntryRef[]): { logged: number; total: number } | null {
  const slots = new Set(meals.map((m) => m.spec?.id).filter((id): id is string => !!id));
  if (slots.size === 0) return null;
  const done = new Set(entries.map((e) => e.mealSlot).filter((s): s is string => !!s && slots.has(s)));
  return { logged: done.size, total: slots.size };
}

export function mealProgressLine(p: { logged: number; total: number } | null): string | null {
  if (!p) return null;
  if (p.logged >= p.total) return "All meals logged today";
  return `Meals logged: ${p.logged} of ${p.total}`;
}
