import { createHash, randomBytes } from "crypto";

// The claim link's token (and the other single-use tokens made the same way). Server code only: kept apart from lib/client-claim.ts so the pages that use that file's
// checks (the client profile, Settings, set-password, join-coach) do not ship Node's crypto to the phone.

// 32 random bytes, URL-safe. Only its sha256 is ever stored.
export function generateClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
