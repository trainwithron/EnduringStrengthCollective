// What a stranger sees of someone's name on a shared workout link: first name and last initial ("Alice A."). Group
// members and the person themselves can still see the full name inside the app.
export function publicDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "An athlete";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
