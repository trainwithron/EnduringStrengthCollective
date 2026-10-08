import type { StandingHistory } from "@/lib/macro-resolution";
import { addDaysToKey } from "@/lib/date-key";

// The recalculation question (nutrition phase 6): after a coach sets a NEW calorie target, the client is asked once, on their Nutrition page, "Are you happy with your meal plan?".
// This decides when the question shows. It shows while ALL of these hold:
//  * the target in force today took effect within the last RECALC_PROMPT_DAYS days (a target from months ago is not news),
//  * there was an earlier target with calories and it was DIFFERENT (a client's very first target changes nothing, and re-saving the same number changes nothing),
//  * the client has not already answered for that target date (one answer per real change; the database allows one too).
// Pure: no database, no clock.

export const RECALC_PROMPT_DAYS = 14;

export interface RecalcPrompt {
  // The date the new target took effect: the key the answer is saved under.
  effectiveFrom: string;
  calories: number;
  previousCalories: number;
}

export function recalcPromptFor(history: StandingHistory | null | undefined, answeredDates: readonly string[], todayKey: string): RecalcPrompt | null {
  if (!history || history.length === 0) return null;
  let at = -1;
  for (let i = 0; i < history.length; i++) {
    if (history[i].effective_from <= todayKey) at = i;
    else break;
  }
  if (at < 0) return null;
  const current = history[at];
  if (current.calories == null) return null;
  if (current.effective_from < addDaysToKey(todayKey, -RECALC_PROMPT_DAYS)) return null;
  let previous: number | null = null;
  for (let i = at - 1; i >= 0; i--) {
    const c = history[i].calories;
    if (c != null) {
      previous = c;
      break;
    }
  }
  if (previous == null || previous === current.calories) return null;
  if (answeredDates.includes(current.effective_from)) return null;
  return { effectiveFrom: current.effective_from, calories: current.calories, previousCalories: previous };
}

// What the client sent back, as the coach reads it.
export interface RecalcAnswer {
  id: string;
  happy: boolean;
  changeText: string;
  requestsText: string;
  boring: boolean;
  status: "new" | "handled";
  targetEffectiveFrom: string;
  createdAt: string;
}

export const MAX_ANSWER_TEXT = 500;

// What the client types is trimmed, spaces collapsed, and cut at the database's limit. Returns the columns to write.
export function answerRow(input: { happy: boolean; text: string; boring: boolean }) {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_TEXT).trim();
  return {
    happy: input.happy,
    // The words go where they belong: "what to change" when unhappy, otherwise nothing is asked beyond "boring".
    change_text: input.happy ? "" : text,
    requests_text: input.happy ? text : "",
    boring: input.boring,
  };
}

// The one-step change in meal variety when a client says the plan is boring. Already at the top: no change.
const VARIETY_UP: Record<string, string> = { same_most_days: "few_favorites", few_favorites: "mix_it_up", mix_it_up: "mix_it_up" };
export function moreVariety(current: string): string {
  return VARIETY_UP[current] ?? current;
}
