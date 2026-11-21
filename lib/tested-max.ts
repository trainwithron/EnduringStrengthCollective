// A coach-typed tested max (Ron, Nov 20, wave 2 T2): the lift's name and a weight in pounds, checked the way the database checks them (set_tested_max) so the coach is told
// before anything is sent.

export const TESTED_MAX_LIMIT_LB = 2000;

export function parseTestedMax(name: string, weight: string): { ok: true; name: string; weight: number } | { ok: false; message: string } {
  const lift = name.trim();
  if (!lift) return { ok: false, message: "Name the lift." };
  if (lift.length > 120) return { ok: false, message: "That lift name is too long." };
  const w = Number(weight.trim().replace(",", "."));
  if (!Number.isFinite(w) || w <= 0 || w > TESTED_MAX_LIMIT_LB) return { ok: false, message: `Type the tested max in pounds, from 1 to ${TESTED_MAX_LIMIT_LB}.` };
  return { ok: true, name: lift, weight: Math.round(w * 10) / 10 };
}

export interface TestedMaxRow {
  exercise_name: string;
  estimated_max: number | string;
  locked: boolean | null;
  tested_at: string | null;
}

/** The locked rows, by lowercased lift name (the cards match names the same way). */
export function testedByName(rows: TestedMaxRow[] | null | undefined): Map<string, { name: string; weight: number; at: string | null }> {
  const out = new Map<string, { name: string; weight: number; at: string | null }>();
  for (const r of rows ?? []) {
    if (r.locked !== true) continue;
    const weight = Number(r.estimated_max);
    if (!Number.isFinite(weight)) continue;
    out.set(r.exercise_name.trim().toLowerCase(), { name: r.exercise_name, weight, at: r.tested_at });
  }
  return out;
}
