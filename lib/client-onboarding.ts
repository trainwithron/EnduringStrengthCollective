// A client who has only just joined, or who has not finished their intake yet, is still getting started: nothing about them
// is overdue, so they should not appear as "needs attention" (no program yet, no macros yet). Once the intake is done and
// a few days have passed, the normal rules apply.
export const ONBOARDING_GRACE_DAYS = 3;

export function isStillOnboarding(args: {
  joinedAt: string | null;
  intakeRequired: boolean;
  intakeCompleted: boolean;
  now: Date;
}): boolean {
  if (args.intakeRequired && !args.intakeCompleted) return true;
  if (!args.joinedAt) return false;
  const joined = new Date(args.joinedAt).getTime();
  if (Number.isNaN(joined)) return false;
  return args.now.getTime() - joined < ONBOARDING_GRACE_DAYS * 86400000;
}
