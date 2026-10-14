// No AUTOMATIC calorie suggestion lowers a youth client's calories. The calculator's starting target stays at maintenance; the WEEKLY engine's result is held the same way: a suggestion that would
// lower calories keeps the current calories instead, and says so plainly. Nothing limits what the coach decides: any calorie or macro target can be typed by hand.
// An unknown age is not guessed: with no date of birth on file nothing is held (the starting target needs the date of birth, so a client with none gets no target at all).

export const ADULT_AGE = 18;

export const isUnder18 = (ageYears: number | null | undefined): boolean => ageYears != null && ageYears < ADULT_AGE;

export const YOUTH_NO_AUTO_NOTE = "No automatic calorie suggestions for youth clients. Set the target you decide.";
export const MINOR_HOLD_NOTE = YOUTH_NO_AUTO_NOTE;

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
  if (isUnder18(args.ageYears) && args.phase === "fat_loss") return YOUTH_NO_AUTO_NOTE;
  return null;
}
