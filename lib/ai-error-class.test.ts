import { describe, it, expect } from "vitest";
import { classifyAiHttpError, classifyAiThrown } from "./ai-error-class";

describe("AI error class", () => {
  it("names a rejected key", () => {
    expect(classifyAiHttpError(401)).toBe("auth");
    expect(classifyAiHttpError(403)).toBe("auth");
  });
  it("names an empty balance or a spend limit, whichever status carries it", () => {
    expect(classifyAiHttpError(402)).toBe("credit");
    expect(classifyAiHttpError(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}')).toBe("credit");
    expect(classifyAiHttpError(429, "You have reached your specified API usage limit")).toBe("credit");
    expect(classifyAiHttpError(429, '{"error_code":"enforced_spend_limit_reached"}')).toBe("credit");
  });
  it("tells a plain rate limit from a credit problem", () => {
    expect(classifyAiHttpError(429, "rate_limit_error")).toBe("rate_limit");
  });
  it("names a model the key cannot use, an overload, a server fault and a bad request", () => {
    expect(classifyAiHttpError(404)).toBe("model_not_found");
    expect(classifyAiHttpError(529)).toBe("overloaded");
    expect(classifyAiHttpError(500)).toBe("server_error");
    expect(classifyAiHttpError(400, "invalid_request_error: max_tokens")).toBe("bad_request");
  });
  it("names a call that never got an answer", () => {
    expect(classifyAiThrown(new TypeError("fetch failed"))).toBe("network");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyAiThrown(abort)).toBe("timeout");
    expect(classifyAiThrown("weird")).toBe("network");
  });
});
