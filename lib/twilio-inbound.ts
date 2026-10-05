import { createHmac, timingSafeEqual } from "crypto";

// Twilio signs every webhook request: base64(HMAC-SHA1(authToken, fullUrl +
// each POST param name+value, params sorted by name)). Verifying it is the
// only authentication the inbound route has (there is no user session), so
// an unsigned or tampered request must never change anyone's consent.
// https://www.twilio.com/docs/usage/security#validating-requests
export function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  providedSignature: string | null
): boolean {
  if (!providedSignature) return false;
  const expected = Buffer.from(computeTwilioSignature(url, params, authToken));
  const given = Buffer.from(providedSignature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type SmsKeyword = "stop" | "start" | "help" | "other";

// Twilio's standard opt-out / opt-in / help keywords (case-insensitive,
// whole message, surrounding whitespace ignored).
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);

export function classifySmsKeyword(body: string | null | undefined): SmsKeyword {
  const word = (body ?? "").trim().toLowerCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (word === "help") return "help";
  return "other";
}

export const SMS_HELP_REPLY =
  "Spotlight Coaching: appointment and check-in texts from your coach. Msg & data rates may apply. " +
  "Reply STOP to cancel. Manage choices in the app under Settings > Text messages.";

// An empty TwiML response (no auto-reply). Twilio's default opt-out
// handling already sends the standard STOP/START confirmation text.
export function twimlResponse(message?: string): string {
  const escaped = message
    ? message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : null;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${escaped ? `<Message>${escaped}</Message>` : ""}</Response>`;
}
