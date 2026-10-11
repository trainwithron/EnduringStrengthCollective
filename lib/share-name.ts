import { isMinorDob } from "@/lib/youth-block";

// Whether a client's first name is shown on their shared workout pictures. The client's own choice (profiles.show_name_on_share, true or false) always wins. With no choice yet
// (null) the default depends on age: OFF under 18, ON for an adult, and ON when there is no date of birth on file (the same "unknown is not a minor" rule the rest of the app uses).
export function resolveShowName(stored: boolean | null | undefined, dateOfBirth: string | null | undefined, asOf: Date = new Date()): boolean {
  if (stored === true || stored === false) return stored;
  return !isMinorDob(dateOfBirth, asOf);
}
