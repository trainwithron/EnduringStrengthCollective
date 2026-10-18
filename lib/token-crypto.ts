import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Sign-in tokens for a person's wearable and Google Calendar connections are kept scrambled in the database, so that someone who reads a copy of the
// database (a leaked backup, a mis-shared export) cannot use them to read anyone's health data or calendar.
//
// It is OFF until WEARABLE_TOKEN_KEY is set (32 random bytes, as 64 hex characters or base64). Until then tokens are stored exactly as before, and a
// token that is already stored unscrambled is always read as it is, so switching it on needs no pause: new and refreshed tokens are scrambled as they
// are written, and /api/cron/protect-wearable-tokens scrambles the ones already stored. A scrambled token is "enc:v1:" + base64url(iv + ciphertext + tag).
// Each scrambled token is bound to WHO IT BELONGS TO (the kind of connection, the provider and the person) and to which of the two tokens it is, so someone who can write to the database cannot move
// one person's scrambled token onto another person's row or swap the access and refresh tokens: it simply fails to open. If the key is lost the scrambled tokens cannot be read; those people just reconnect their device.

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function readKey(): Buffer | null {
  const raw = (process.env.WEARABLE_TOKEN_KEY ?? "").trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("WEARABLE_TOKEN_KEY must be 32 bytes (64 hex characters or base64).");
  return key;
}

export function tokenCryptoEnabled(): boolean {
  return readKey() !== null;
}

export function isSealedToken(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export type TokenField = "access" | "refresh";

/** Who a stored token belongs to, for binding it to its row: the kind of connection, the provider and the person. */
export const tokenOwner = (kind: "wearable" | "calendar", provider: string, personId: string): string => `${kind}:${provider}:${personId}`;

const aadFor = (owner: string, field: TokenField) => Buffer.from(`${owner}|${field}`, "utf8");

/** Scrambles a token for storage; returns it unchanged when no key is set. */
export function sealToken(plain: string, owner: string, field: TokenField): string {
  const key = readKey();
  if (!key || isSealedToken(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(owner, field));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The usable token: a scrambled one is unscrambled, one stored as-is is returned as it is. */
export function openToken(stored: string, owner: string, field: TokenField): string {
  if (!isSealedToken(stored)) return stored;
  const key = readKey();
  if (!key) throw new Error("This connection's token is stored scrambled and the key is not set here.");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error("This connection's stored token is damaged.");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, IV_BYTES));
  decipher.setAAD(aadFor(owner, field));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES, buf.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("This connection's stored token could not be read with the key set here.");
  }
}

/** A one-way fingerprint of a token (not secret, not reversible) so a push that carries the token can be matched to its connection without keeping the token readable. */
export function tokenHash(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/**
 * The columns to write for a connection's tokens. `withHash` adds the fingerprint column (only wearable_oauth_tokens has it; every writer of a wearable token includes it, and so must any future
 * Garmin refresh: Garmin pushes are found by it). This NEVER throws: it runs right after a provider has handed over new tokens (often single-use), and losing them because the key is unusable
 * would lock the person out until they reconnect. If scrambling fails (a malformed key) the tokens are stored as they are, the problem is logged without any token text, and the daily job
 * (which reports a bad key as a failed run) scrambles them once the key is fixed.
 */
export function sealedTokenColumns(tokens: { accessToken: string; refreshToken: string }, owner: string, opts: { withHash?: boolean } = {}) {
  let access = tokens.accessToken;
  let refresh = tokens.refreshToken;
  try {
    access = sealToken(tokens.accessToken, owner, "access");
    refresh = sealToken(tokens.refreshToken, owner, "refresh");
  } catch (err) {
    access = tokens.accessToken;
    refresh = tokens.refreshToken;
    console.error("token-crypto: tokens stored unscrambled because the key is unusable:", err instanceof Error ? err.message : "unknown");
  }
  return {
    access_token: access,
    refresh_token: refresh,
    ...(opts.withHash ? { access_token_hash: tokenHash(tokens.accessToken) } : {}),
  };
}

/** The usable tokens from a stored row. */
export function openTokenRow(row: { access_token: string; refresh_token: string }, owner: string) {
  return { accessToken: openToken(row.access_token, owner, "access"), refreshToken: openToken(row.refresh_token, owner, "refresh") };
}
