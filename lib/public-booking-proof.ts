import { createHmac, timingSafeEqual } from "crypto";

// Proof that a visitor to a coach's public booking page is a real person with a real inbox, kept without a database table:
// everything is a signed value the server can check later.
//
//   * form token   issued when the page loads. A booking is refused without one, and refused if it arrives too soon after it was
//                  issued, whatever the browser claims (a bot that skips the page has no token, one that fills the form instantly
//                  is too fast).
//   * email code   six digits emailed to the address. It proves the visitor can read that inbox, so the platform never sends a
//                  booking email to an address nobody confirmed.
//   * email proof  what the server hands back for a right code; the booking must carry one for the same page and address.
//
// The signing secret is PUBLIC_BOOKING_SECRET, or the service role key when that is not set. Neither ever reaches the browser.

const FORM_MIN_SECONDS = 4;
const FORM_MAX_AGE_MS = 6 * 3600 * 1000;
const CODE_BUCKET_MS = 15 * 60 * 1000;
const PROOF_LIFETIME_MS = 30 * 60 * 1000;

function secret(): string {
  const s = process.env.PUBLIC_BOOKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No signing secret is configured for public booking.");
  return s;
}

function mac(...parts: (string | number)[]): string {
  return createHmac("sha256", secret()).update(parts.join("|"), "utf8").digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function canSignProofs(): boolean {
  return Boolean(process.env.PUBLIC_BOOKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ---- form token ----------------------------------------------------------------------------------------------------------
export function signFormToken(slug: string, nowMs: number): string {
  return `${nowMs}.${mac("form", slug, nowMs)}`;
}

export function checkFormToken(token: unknown, slug: string, nowMs: number): { ok: true; issuedMs: number } | { ok: false } {
  if (typeof token !== "string") return { ok: false };
  const [issuedRaw, sig] = token.split(".");
  const issuedMs = Number(issuedRaw);
  if (!sig || !Number.isFinite(issuedMs)) return { ok: false };
  if (!same(sig, mac("form", slug, issuedMs))) return { ok: false };
  const age = nowMs - issuedMs;
  if (age < FORM_MIN_SECONDS * 1000 || age > FORM_MAX_AGE_MS) return { ok: false };
  return { ok: true, issuedMs };
}

// ---- email code ----------------------------------------------------------------------------------------------------------
function codeFor(slug: string, email: string, bucket: number): string {
  const digest = createHmac("sha256", secret()).update(`code|${slug}|${email}|${bucket}`, "utf8").digest();
  return String(digest.readUInt32BE(0) % 1000000).padStart(6, "0");
}

export function emailCodeNow(slug: string, email: string, nowMs: number): string {
  return codeFor(slug, email, Math.floor(nowMs / CODE_BUCKET_MS));
}

// The current code or the one before it, so a code sent just before a bucket changes still works: valid for 15 to 30 minutes.
export function emailCodeIsValid(slug: string, email: string, code: unknown, nowMs: number): boolean {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const bucket = Math.floor(nowMs / CODE_BUCKET_MS);
  return same(code, codeFor(slug, email, bucket)) || same(code, codeFor(slug, email, bucket - 1));
}

// ---- email proof ---------------------------------------------------------------------------------------------------------
export function signEmailProof(slug: string, email: string, nowMs: number): string {
  const expires = nowMs + PROOF_LIFETIME_MS;
  return `${expires}.${mac("email", slug, email, expires)}`;
}

export function checkEmailProof(proof: unknown, slug: string, email: string, nowMs: number): boolean {
  if (typeof proof !== "string") return false;
  const [expiresRaw, sig] = proof.split(".");
  const expires = Number(expiresRaw);
  if (!sig || !Number.isFinite(expires) || expires < nowMs || expires - nowMs > PROOF_LIFETIME_MS) return false;
  return same(sig, mac("email", slug, email, expires));
}
