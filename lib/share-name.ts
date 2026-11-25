import { ageStatusOf } from "@/lib/youth-block";

// Whether a client's first name is shown on their shared workout pictures. Only an adult (a known date of birth, 18 or over) can have it on: for them their own choice (profiles.show_name_on_share, true or false) wins, and with no choice yet
// (null) it is ON. OFF under 18 AND OFF when there is no date of birth on file (an unknown age is protected like a minor everywhere else
// in the app; this was ON before release E).
// coachConfirmedAdult: no birthday on file and a coach confirmed 18 or older (step 230): an adult like any other.
export function resolveShowName(stored: boolean | null | undefined, dateOfBirth: string | null | undefined, asOf: Date = new Date(), coachConfirmedAdult = false): boolean {
  // Someone under 18, or whose age is not on file, never has a name on a shared picture, whatever the switch says (it is not offered to them either): an unknown age is protected like a minor everywhere else.
  if (ageStatusOf(dateOfBirth, coachConfirmedAdult, asOf) !== "adult") return false;
  if (stored === true || stored === false) return stored;
  return true;
}
