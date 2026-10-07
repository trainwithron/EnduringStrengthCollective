// No calorie deficit is ever suggested for a client under 18. The calculator's starting target already holds a minor at maintenance; this holds the WEEKLY engine's
// result the same way: a suggestion that would lower a minor's calories keeps their current calories instead, and says why. A coach can still set any number by hand.
// An unknown age is not guessed: with no date of birth on file nothing is held (the starting target needs the date of birth, so a client with none gets no target at all).

export const ADULT_AGE = 18;

export const isUnder18 = (ageYears: number | null | undefined): boolean => ageYears != null && ageYears < ADULT_AGE;

export const MINOR_HOLD_NOTE = "Held at the current calories: this client is under 18, and no calorie deficit is suggested for anyone under 18.";

export function holdDeficitForMinor<T extends { newCalories: number; rationale: string }>(args: {
  ageYears: number | null | undefined;
  currentCalories: number;
  result: T;
}): { result: T; held: boolean } {
  if (!isUnder18(args.ageYears) || args.result.newCalories >= args.currentCalories) return { result: args.result, held: false };
  return { result: { ...args.result, newCalories: args.currentCalories, rationale: `${args.result.rationale} ${MINOR_HOLD_NOTE}` }, held: true };
}

// Said wherever a suggestion is shown for a client with no date of birth: age is unknown, so the under-18 rule could not be checked.
export const AGE_UNKNOWN_NOTE = "No date of birth on file, so age is unknown and no under-18 protection could be applied.";

// What a coach is told on a client's Targets about the under-18 rule, or null when it has nothing to say: no date of birth (the rule cannot run), or a minor in a fat-loss
// phase (a weekly cut is held, which writes no suggestion, so the coach would otherwise wonder why none appeared).
export function minorSafetyLine(args: { ageYears: number | null | undefined; phase: string | null | undefined; clientName: string }): string | null {
  if (args.ageYears == null) return `${AGE_UNKNOWN_NOTE} Ask ${args.clientName} to fill in About you.`;
  if (isUnder18(args.ageYears) && args.phase === "fat_loss") return `${args.clientName} is under 18, so no calorie deficit is suggested: a weekly cut is held at their current calories.`;
  return null;
}
