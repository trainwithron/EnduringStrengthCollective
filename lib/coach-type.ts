// What a coach coaches: the one question asked at signup. It decides which way Add client leans first and the name of the first space; the bigger "Home by role" waits for the team-coach design.
export type CoachType = "personal" | "team" | "gym";

export const COACH_TYPES: { value: CoachType; label: string; hint: string }[] = [
  { value: "personal", label: "One-on-one clients", hint: "Personal training or online coaching." },
  { value: "team", label: "A team or a class", hint: "A school or club team, a class or a group program." },
  { value: "gym", label: "A gym with several coaches", hint: "You run the business and other coaches work with you." },
];

export function isCoachType(value: unknown): value is CoachType {
  return value === "personal" || value === "team" || value === "gym";
}

// The name of the first group made at signup.
export function starterGroupName(type: CoachType | null): string {
  return type === "team" ? "My Team" : "Main Group";
}
