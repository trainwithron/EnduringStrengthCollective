import { createHmac, timingSafeEqual } from "node:crypto";

// A workout card for a workout with no feed post (a client who keeps workouts off the group feed, or a one-on-one client) is opened with the workout log's
// id PLUS a signature only the server can make, so a teammate who can see log ids in the feed data cannot open a card the client chose not to post.
// Link shape: /share/<workout log id>.<signature>. Server only.
function secret(): string {
  const s = process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) throw new Error("No secret is configured for share links.");
  return s;
}

export function signShareId(id: string): string {
  return createHmac("sha256", secret()).update(`share:${id}`).digest("hex").slice(0, 32);
}

export function shareHref(id: string): string {
  return `/share/${id}.${signShareId(id)}`;
}

// Splits "<id>" or "<id>.<signature>". The signature is only checked for the workout-log form.
export function parseShareParam(param: string): { id: string; signature: string | null } {
  const dot = param.indexOf(".");
  if (dot < 0) return { id: param, signature: null };
  return { id: param.slice(0, dot), signature: param.slice(dot + 1) || null };
}

export function verifyShareSignature(id: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    const expected = Buffer.from(signShareId(id));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
