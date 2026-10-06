import { createHmac, timingSafeEqual } from "node:crypto";

// A short-lived, tamper-proof token the server hands out and checks again (server only). Ask Spot uses it so a change a coach has been shown ("Change 'clients' to
// 'athletes'?") can only be confirmed with exactly what was shown, by the coach it was shown to, within a few minutes: the token carries the coach, the action, its
// numbers, what the value was before, and an expiry, all signed. Nothing the browser sends can alter them without the signature failing.
function secret(): string {
  const s = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) throw new Error("No secret is configured for signed tokens.");
  return s;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function mac(purpose: string, body: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${body}`).digest("base64url");
}

export function signToken(purpose: string, payload: Record<string, unknown>, ttlSeconds: number, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 }));
  return `${body}.${mac(purpose, body)}`;
}

export function verifyToken<T extends Record<string, unknown>>(purpose: string, token: unknown, now: number = Date.now()): (T & { exp: number }) | null {
  if (typeof token !== "string" || token.length > 4000) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  try {
    const expected = Buffer.from(mac(purpose, body));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const payload = JSON.parse(unb64(body)) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
