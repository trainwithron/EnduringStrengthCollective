// A short, safe name for WHY an AI call failed, stored in ai_usage_log.error_class (0292) and shown to the platform admin. Never the message, never anything
// a person typed: only one of these words. (Assistant, Oct 7: every real AI call had failed since Oct 5 and nothing recorded the cause.)

export type AiErrorClass =
  | "auth" // the key was rejected or is missing a permission
  | "credit" // the Anthropic balance is empty or a spend limit was reached
  | "model_not_found" // the model name is not available to this key
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "bad_request"
  | "network" // the request never got an answer (DNS, connection, a malformed header)
  | "timeout"
  | "unknown";

const CREDIT_WORDS = /credit balance|billing|spend limit|spend_limit|usage limit|purchase credits|plans & billing/i;

// An error answer from the API: its HTTP status and (optionally) its body text, which is only searched, never kept.
export function classifyAiHttpError(status: number, body = ""): AiErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";
  if (status === 429) return CREDIT_WORDS.test(body) ? "credit" : "rate_limit";
  if (status === 404) return "model_not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server_error";
  if (status === 400) return CREDIT_WORDS.test(body) ? "credit" : "bad_request";
  if (status >= 400) return "bad_request";
  return "unknown";
}

// A request that threw before any answer (the fetch itself failed).
export function classifyAiThrown(err: unknown): AiErrorClass {
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  return "network";
}
