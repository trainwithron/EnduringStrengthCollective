import { publicDisplayName } from "@/lib/public-name";

// "Sam R." for a member under 18, the full name otherwise. "*" in the set means the age lookup failed: everyone is shortened rather than risk showing a child's full name. Pure, so a screen that runs in the
// browser can use it (the lookup itself, lib/minor-names.ts, runs on the server only).
export function shownName(fullName: string | null | undefined, profileId: string, minors: Set<string>): string {
  const name = fullName?.trim() || "Unknown";
  return minors.has("*") || minors.has(profileId) ? publicDisplayName(name) : name;
}
