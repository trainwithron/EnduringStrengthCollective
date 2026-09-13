// COPPA (13+) age check — pure date math, no DB access.
export function isUnder13(dateOfBirth: string, asOf: Date): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  const thirteenthBirthday = new Date(dob);
  thirteenthBirthday.setFullYear(thirteenthBirthday.getFullYear() + 13);
  return asOf < thirteenthBirthday;
}

// General "at least N years old" check, same date math as isUnder13 —
// reused beyond COPPA's fixed 13+ threshold (e.g. the 18+ gate on video
// calling). A missing/unknown date of birth is deliberately NOT treated
// as a pass here — the caller decides what "unknown" means for its own
// feature (video calling treats it as ineligible, requiring positive
// confirmation of adult status rather than defaulting to allowed).
export function meetsMinimumAge(dateOfBirth: string, minimumAge: number, asOf: Date): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  const birthdayAtMinimum = new Date(dob);
  birthdayAtMinimum.setFullYear(birthdayAtMinimum.getFullYear() + minimumAge);
  return asOf >= birthdayAtMinimum;
}
