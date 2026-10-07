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
