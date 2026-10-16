import { safePushPath } from "@/lib/push-url";

// Where to go after signing in (?next=...). Only a path inside this app is ever followed: no other address, no "//host", no backslash tricks ("/\host" is read by browsers as "//host"), no control characters,
// and the final address, worked out the way the browser will, must still be on this same origin. Anything else is the fallback.
export function safeNextPath(next: unknown, origin: string, fallback: string = "/"): string {
  const path = safePushPath(next);
  if (path === "/" && next !== "/") return fallback;
  if (path.includes("\\")) return fallback;
  try {
    const resolved = new URL(path, origin);
    if (resolved.origin !== new URL(origin).origin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
