// A prescribed weight has to be one that can be loaded. Computed targets are rounded to the smallest step the athlete's bar and plates can make: 5 lb by default (2.5 kg), or 2.5 lb / 1.25 kg with micro-plates.
// A percent of a max rounds DOWN (never ask for more than the percent says); an added increment rounds to the nearest step. A result never rounds to zero.
export type LoadUnit = "lb" | "kg";

export const DEFAULT_STEP: Record<LoadUnit, number> = { lb: 5, kg: 2.5 };
export const MICRO_STEP: Record<LoadUnit, number> = { lb: 2.5, kg: 1.25 };

export function roundLoad(value: number, step: number, mode: "down" | "nearest"): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(step) || step <= 0) return value;
  const units = value / step;
  const rounded = mode === "down" ? Math.floor(units + 1e-9) : Math.round(units);
  return Math.max(step, rounded * step);
}
