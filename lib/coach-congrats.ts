// The line a client sees from their coach right after finishing a workout. The coach can write their own; without
// one it reads as the coach speaking, warm and plain. "{name}" in a coach's own message is replaced with the client's
// first name.
export function buildCoachCongrats({
  athleteFirstName,
  customMessage,
  hadPr,
}: {
  athleteFirstName: string;
  customMessage: string | null;
  hadPr: boolean;
}): string {
  const name = athleteFirstName.trim() || "Hey";
  const custom = customMessage?.trim();
  if (custom) return custom.split("{name}").join(name);
  return hadPr
    ? `${name}, that was a new personal best. It took real work and I'm proud of you.`
    : `${name}, you just did something hard. I'm proud of you for showing up.`;
}

export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
