// The browser's side of the allergy auto-rebuild: after a client saves their allergies or foods they avoid, ask the server to swap any option of their plan that now clashes
// (app/api/nutrition/allergy-rebuild). Best effort: a failure changes nothing (their screen already hides a clashing option, and the coach sees the clash).
export async function runAllergyRebuild(): Promise<{ daysChanged: number; mealsNeedingCoach: number } | null> {
  try {
    const res = await fetch("/api/nutrition/allergy-rebuild", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { daysChanged?: unknown; mealsNeedingCoach?: unknown };
    return { daysChanged: Number(data.daysChanged) || 0, mealsNeedingCoach: Number(data.mealsNeedingCoach) || 0 };
  } catch {
    return null;
  }
}
