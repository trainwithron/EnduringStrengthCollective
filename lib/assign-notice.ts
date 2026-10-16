import { ageStatusFromDob } from "@/lib/youth-block";

// Shown on the Assign screen before a program goes to a client, from what is on file NOW (not what was true when the program was built): a client under 18, a client with no birthdate on file, or a client with a
// flagged health concern gets a plain note so the coach looks at the program with that in mind before it reaches them. Pure.
export interface AssignClientFacts {
  name: string;
  dateOfBirth: string | null;
  parqFlagged: boolean;
}

export function assignNotices(clients: AssignClientFacts[], asOf: Date = new Date()): string[] {
  const minors = clients.filter((c) => ageStatusFromDob(c.dateOfBirth, asOf) === "minor").map((c) => c.name);
  const unknown = clients.filter((c) => ageStatusFromDob(c.dateOfBirth, asOf) === "unknown").map((c) => c.name);
  const health = clients.filter((c) => c.parqFlagged).map((c) => c.name);
  const list = (names: string[]) => (names.length <= 3 ? names.join(", ") : names.slice(0, 3).join(", ") + " and " + (names.length - 3) + " more");
  const out: string[] = [];
  if (minors.length > 0) out.push(list(minors) + (minors.length === 1 ? " is" : " are") + " under 18. Check the program is technique first, with no max testing and no maximal loads.");
  if (unknown.length > 0) out.push(list(unknown) + (unknown.length === 1 ? " has" : " have") + " no birthdate on file. Check their age before you assign.");
  if (health.length > 0) out.push(list(health) + (health.length === 1 ? " has" : " have") + " a flagged health concern on their screening. Check the program works around it.");
  return out;
}
