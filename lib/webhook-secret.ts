import { timingSafeEqual } from "node:crypto";

// Compares a secret a caller sent with the one this app expects, in constant time. Used for webhooks whose only credential is a
// shared secret in a header. A missing expected secret never matches (an unset secret must not let anything in), and so does a
// missing or different-length value.
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
