// COPPA (13+) age check — pure date math, no DB access.
export function isUnder13(dateOfBirth: string, asOf: Date): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  const thirteenthBirthday = new Date(dob);
  thirteenthBirthday.setFullYear(thirteenthBirthday.getFullYear() + 13);
  return asOf < thirteenthBirthday;
}
