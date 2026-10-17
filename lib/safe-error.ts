// What a person is told when something fails on the server. Our own errors (a rate limit, "AI is not set up", "that took too long", "that was cut off") are written in plain words for the person and are passed through;
// anything else (a message from the database, the AI provider, Stripe, a network library) is for the log, never for the screen. The person gets a short plain sentence, the log gets the real text.
const PLAIN_ERRORS = new Set(["AiRateLimitedError", "AiNotConfiguredError", "AiTimeoutError", "AiTruncatedError"]);

export const SAFE_FALLBACK = "Try again in a moment.";

export function safeErrorDetail(err: unknown, fallback: string = SAFE_FALLBACK): string {
  if (err instanceof Error && PLAIN_ERRORS.has(err.name)) return err.message;
  console.error("[request failed]", err instanceof Error ? err.message : err);
  return fallback;
}
