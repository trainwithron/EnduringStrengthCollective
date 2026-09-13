// Peaking & Tapering — Endurance Race Taper v1
// (goal_date_aware_nutrition_and_programming_idea.md). Built first per
// Ron's own confirmed build order: endurance evidence is stronger (two
// converging meta-analyses, plus a real 158,117-runner Strava dataset)
// and it's a genuinely simpler one-envelope problem than strength —
// volume comes down, intensity/pace stays completely frozen (research
// found moving intensity produces zero benefit, SMD+0.25, p>0.05).
//
// v1 scope, confirmed: the final 1-3 weeks before the event only —
// nothing earlier is ever touched by this.
export type TaperProfile = "recreational" | "elite";

// Race-week volume floor. Recreational default matches the meta-
// analytic 41-60% cut range's midpoint (Bosquet 2007, Wang 2023). Elite
// athletes get a real, sourced exception: Canova's own elite-marathon
// practice (100+ miles the week before Boston) directly contradicts a
// full 50% cut — a smaller ~30% cut is exposed as an explicit opt-in
// profile rather than silently applying the recreational default to
// someone it visibly doesn't fit.
const RACE_WEEK_VOLUME_FLOOR: Record<TaperProfile, number> = {
  recreational: 0.5,
  elite: 0.7,
};

export interface EnduranceTaperWeek {
  weeksBeforeEvent: number; // 0 = race week itself
  volumeMultiplier: number; // multiply the athlete's own pre-taper weekly distance by this; intensity/pace untouched
}

// Monotone linear decay across `taperWeeks` (1-3, per the resolved v1
// scope) down to the race-week floor — the "one genuinely new function"
// the research called for, everything else reuses existing distance/
// pace and interval infrastructure.
export function computeEnduranceTaperSchedule(
  taperWeeks: number,
  profile: TaperProfile = "recreational"
): EnduranceTaperWeek[] {
  if (taperWeeks < 1) return [];
  const floor = RACE_WEEK_VOLUME_FLOOR[profile];
  const weeks: EnduranceTaperWeek[] = [];
  for (let i = 0; i < taperWeeks; i++) {
    const weeksBeforeEvent = taperWeeks - 1 - i;
    const progress = taperWeeks > 1 ? i / (taperWeeks - 1) : 1;
    const volumeMultiplier = Math.round((1 - progress * (1 - floor)) * 100) / 100;
    weeks.push({ weeksBeforeEvent, volumeMultiplier });
  }
  return weeks;
}

// The one multiplier for however many whole weeks remain right now —
// clamps to the race-week floor once the event date has passed (a
// missed event is not a reason to suddenly apply full volume again) and
// to full volume (1.0, no taper) once further out than the schedule
// covers.
export function currentTaperMultiplier(
  weeksBeforeEvent: number,
  taperWeeks: number,
  profile: TaperProfile = "recreational"
): number {
  if (weeksBeforeEvent < 0) return RACE_WEEK_VOLUME_FLOOR[profile];
  if (weeksBeforeEvent >= taperWeeks) return 1;
  const schedule = computeEnduranceTaperSchedule(taperWeeks, profile);
  return schedule.find((w) => w.weeksBeforeEvent === weeksBeforeEvent)?.volumeMultiplier ?? 1;
}
