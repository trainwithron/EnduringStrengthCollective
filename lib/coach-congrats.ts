// The line a client sees from their coach right after finishing a workout. Only the coach's own words speak as the coach (Ron, Nov 20, R6): with no line written by
// the coach, the client sees none (an automatic "I'm proud of you" read as the coach's own words). "{name}" in the coach's message is replaced with the client's first name.
export const SUGGESTED_CONGRATS = "{name}, you just did something hard. I'm proud of you for showing up.";

export function buildCoachCongrats({
  athleteFirstName,
  customMessage,
}: {
  athleteFirstName: string;
  customMessage: string | null;
}): string | null {
  const custom = customMessage?.trim();
  if (!custom) return null;
  const name = athleteFirstName.trim() || "Hey";
  return custom.split("{name}").join(name);
}

export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
