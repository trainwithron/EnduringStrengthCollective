import { shortDateLabel } from "@/lib/apply-from";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { PHASE_LABELS } from "@/lib/phase-plan";
import type { PathAssessment, PhaseReview } from "@/lib/phase-review";
import { formatWeight, type WeightUnit } from "@/lib/units";

// The words on the phase review card, worked out from the numbers. Pure; the card only shows them.

export function resultLines(r: PhaseReview, unit: WeightUnit): string[] {
  const lines = [`Week ${r.weeksInPhase} of ${PHASE_LABELS[r.phase].toLowerCase()}. Looking at the ${r.elapsedDays} days since ${shortDateLabel(r.windowStart)}.`];
  if (r.changeLbs != null && r.startAvg != null && r.latestAvg != null && r.weeklyRatePct != null) {
    const moved = r.changeLbs === 0 ? "no change" : `${r.changeLbs < 0 ? "down" : "up"} ${formatWeight(Math.abs(r.changeLbs), unit)}`;
    lines.push(`Weight: ${formatWeight(r.startAvg, unit)} to ${formatWeight(r.latestAvg, unit)} (${moved}), about ${Math.abs(r.weeklyRatePct).toFixed(1)} percent of body weight a week.`);
  } else {
    lines.push("Weight: no trend to show yet.");
  }
  lines.push(`Food logged on ${r.daysLogged} of ${r.elapsedDays} days.`);
  if (r.calories != null) lines.push(`Calories now: ${r.calories.toLocaleString("en-US")}${r.underFloor ? ", under the soft floor for them (a warning only, nothing is blocked)." : "."}`);
  return lines;
}

export function verdictLine(r: PhaseReview, firstName: string): string {
  switch (r.verdict) {
    case "on_track":
      return `${firstName} is moving the way this phase aims for, at a sensible speed.`;
    case "low_adherence":
      return `${firstName} logged food on ${r.daysLogged} of ${r.elapsedDays} days, so the result does not say much yet.`;
    case "no_change":
      return `No real change in ${r.elapsedDays} days, with food logged on ${r.daysLogged} of them.`;
    case "wrong_way":
      return `Weight is going the other way from what this phase aims for, with food logged on ${r.daysLogged} of ${r.elapsedDays} days.`;
    case "too_fast":
      return "Weight is changing faster than the usual safe range. Slowing down is the safer call.";
    default:
      return r.thin === "too_early" ? "Under two weeks of the phase so far, too early to read a weight trend." : "Too few weigh-ins to read a weight trend yet.";
  }
}

export function stanceLine(a: PathAssessment, phase: NutritionPhase, next: NutritionPhase): string {
  const to = next === phase ? `continuing ${PHASE_LABELS[next].toLowerCase()}` : `moving to ${PHASE_LABELS[next].toLowerCase()}`;
  if (a.stance === "supports") return `The numbers support ${to}.`;
  if (a.stance === "does_not_support") return `The numbers do not support ${to} yet.`;
  return `The numbers do not say clearly about ${to}.`;
}
