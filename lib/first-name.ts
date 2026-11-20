// A person's first name for a greeting: "Ron" from "Ron Arnold", and from "Coach Ron" too (a leading "Coach" is a title, not a name). "Coach" alone, or no
// name, gives "" so the greeting goes without one. Shared by the coach's Home band (lib/home-greeting.ts) and the client's Home (lib/client-home-greeting.ts).
export function greetingFirstName(fullName: string | null | undefined): string {
  const rest = (fullName ?? "").trim().replace(/^coach(?:\s+|$)/i, "");
  return rest.split(/\s+/)[0] ?? "";
}
