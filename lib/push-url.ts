// A push notification opens a link when tapped. Only an in-app path is allowed: a notification that could open any
// address would be a way to send people to another site from the app's own name. Anything else becomes the app home.
export function safePushPath(url: unknown): string {
  if (typeof url !== "string") return "/";
  const trimmed = url.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(trimmed)) return "/";
  return trimmed.slice(0, 500);
}
