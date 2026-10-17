import { ageStatusFromDob } from "@/lib/youth-block";

// Whether a client's first name is shown on their shared workout pictures. The client's own choice (profiles.show_name_on_share, true or false) always wins. With no choice yet
// (null) the default depends on age: ON only for someone known to be an adult. OFF under 18 AND OFF when there is no date of birth on file (an unknown age is protected like a minor everywhere else
// in the app; this was ON before release E).
export function resolveShowName(stored: boolean | null | undefined, dateOfBirth: string | null | undefined, asOf: Date = new Date()): boolean {
  if (stored === true || stored === false) return stored;
  return ageStatusFromDob(dateOfBirth, asOf) === "adult";
}
