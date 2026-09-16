import { randomBytes, createHash } from "crypto";

// Zapier's bearer-token auth for /api/zapier/* — a coach generates this
// once (POST /api/coach/api-key), Zapier sends it back as
// `Authorization: Bearer <key>` on every subscribe/unsubscribe call.
// 32 random bytes (256 bits) is far more entropy than anything a
// brute-force attempt could realistically exhaust.
export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

// Only the hash is ever stored (coach_api_keys.api_key_hash) — a
// high-entropy random token doesn't need slow/salted password hashing
// the way a human-chosen password does; a plain SHA-256 lookup is both
// sufficient and lets the server verify a presented key with a single
// indexed equality query instead of hashing every stored key to compare.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
