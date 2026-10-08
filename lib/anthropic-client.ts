// Thin server-only wrapper around Claude's Messages API — used by the AI
// workout-photo importer and the AI meal-plan assist button. A raw fetch
// rather than the SDK: both callers need exactly one shape (send a system
// prompt + user content, get back the text block), so a dependency isn't
// worth adding for that. Never import this from a "use client" component —
// it reads the secret key from process.env.

import type { AiCallMeta } from "@/lib/ai-usage";
import { reserveAiCall } from "@/lib/ai-usage-server";
import { classifyAiHttpError, classifyAiThrown } from "@/lib/ai-error-class";
import { noteAiAttempt } from "@/lib/ai-run-stats";
import { modelCandidates } from "@/lib/ai-model";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";

// AI_DISABLED=true is the kill switch: set it in the host's environment and redeploy and every AI feature reports "not configured" and makes no call (and spends
// nothing), without removing the key.
// The id that last worked after a model-not-found retry (kept for the life of this server instance).
let workingModel: string | null = null;

export function isAiConfigured(): boolean {
  if (process.env.AI_DISABLED === "true") return false;
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ClaudeImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64Data: string;
}

// A whole PDF handed to Claude to read (text and pictures). Used only for a scanned PDF that has no text to extract.
export interface ClaudeDocumentInput {
  mediaType: "application/pdf";
  base64Data: string;
}

export interface ClaudeCallOptions {
  system: string;
  userText: string;
  image?: ClaudeImageInput;
  document?: ClaudeDocumentInput;
  maxTokens?: number;
  // Who/what this call is for — drives usage logging (model + tokens per
  // call, for per-coach cost) and the burst limit (lib/ai-usage.ts).
  // Required so a new call site can't silently skip the cost log.
  meta: AiCallMeta;
}

export const MAX_INPUT_CHARS = 150_000;
export const MAX_IMAGE_BASE64_CHARS = 8_000_000; // about 6 MB of image
export const MAX_DOCUMENT_BASE64_CHARS = 14_000_000; // about 10 MB of PDF
export const MAX_OUTPUT_TOKENS = 32_000;

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI features aren't configured yet — an ANTHROPIC_API_KEY is needed on the server.");
    this.name = "AiNotConfiguredError";
  }
}

// Distinct from a genuinely malformed response: the model was still
// mid-output when it hit maxTokens, so the caller's JSON literally ends
// with an unterminated string/array rather than being wrong. Worth
// surfacing separately so a caller building structured JSON (a program,
// a meal plan) can tell a coach "this was too big, ask for less" instead
// of a raw JSON.parse error pointing at a byte offset.
export class AiTruncatedError extends Error {
  constructor() {
    super("Claude's response was cut off before finishing — the request was too large for the configured token limit.");
    this.name = "AiTruncatedError";
  }
}

// Returns Claude's raw text response. Callers that need structured data
// ask for JSON in the prompt and parse the result themselves — Claude
// reliably follows a "respond with only a JSON array, no other text"
// instruction, and keeping the parsing at the call site lets each feature
// validate its own expected shape rather than sharing one brittle parser.
export async function callClaude({
  system,
  userText,
  image,
  document,
  maxTokens = 4096,
  meta,
}: ClaudeCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !isAiConfigured()) throw new AiNotConfiguredError();

  // One ceiling on a single call, whichever route made it: a route that forgets its own input check cannot send an
  // enormous prompt, ask for an enormous answer, or attach an enormous image on the platform's bill.
  if (userText.length > MAX_INPUT_CHARS || system.length > MAX_INPUT_CHARS) {
    throw new Error("That request is too large to send. Try a shorter one.");
  }
  if (image && image.base64Data.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error("That image is too large. Try a smaller one.");
  }
  if (document && document.base64Data.length > MAX_DOCUMENT_BASE64_CHARS) {
    throw new Error("That PDF is too large. Try a smaller one.");
  }
  maxTokens = Math.min(Math.max(1, maxTokens), MAX_OUTPUT_TOKENS);

  const content: Record<string, unknown>[] = [];
  if (document) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: document.mediaType, data: document.base64Data },
    });
  }
  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64Data },
    });
  }
  content.push({ type: "text", text: userText });

  // Throws AiRateLimitedError when this actor is over the burst limit or
  // the monthly ceiling; otherwise reserves the usage-log row up front.
  const usage = await reserveAiCall(meta);

  const send = (model: string) =>
    fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
      }),
    });

  // The model id comes from ANTHROPIC_MODEL (default below). If the API says the model is not found (404), ask once more with the fallback id and remember
  // which one worked, so a retired or renamed id does not take every AI feature down (Oct 5 outage, cause not yet known).
  const [primary, fallback] = modelCandidates(process.env.ANTHROPIC_MODEL, DEFAULT_MODEL, workingModel);
  let response: Response;
  try {
    response = await send(primary);
    if (response.status === 404 && fallback) {
      console.warn(`AI model "${primary}" was not found; retrying once with "${fallback}".`);
      const retry = await send(fallback);
      if (retry.ok) {
        workingModel = fallback;
        console.warn(`AI model "${fallback}" worked. Set ANTHROPIC_MODEL=${fallback} to make it permanent.`);
      }
      response = retry;
    }
  } catch (err) {
    const errorClass = classifyAiThrown(err);
    noteAiAttempt({ ok: false, errorClass });
    await usage.complete({ status: "error", errorClass });
    throw err;
  }

  if (!response.ok) {
    const detail = await response.text();
    const errorClass = classifyAiHttpError(response.status, detail);
    noteAiAttempt({ ok: false, errorClass });
    await usage.complete({ status: "error", errorClass });
    throw new Error(`Claude API error (${response.status}): ${detail.slice(0, 300)}`);
  }

  noteAiAttempt({ ok: true });
  const data = await response.json();
  // Tokens are billed whether or not the output is usable, so they're
  // recorded for truncated calls too.
  await usage.complete({
    model: data.model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    status: data.stop_reason === "max_tokens" ? "truncated" : "ok",
  });
  if (data.stop_reason === "max_tokens") {
    throw new AiTruncatedError();
  }
  const textBlock = (data.content ?? []).find((b: any) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content.");
  }
  return textBlock.text as string;
}

// Claude sometimes wraps JSON in a ```json fence even when told not to —
// strip it rather than fighting the prompt further.
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}
