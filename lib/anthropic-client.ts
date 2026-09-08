// Thin server-only wrapper around Claude's Messages API — used by the AI
// workout-photo importer and the AI meal-plan assist button. A raw fetch
// rather than the SDK: both callers need exactly one shape (send a system
// prompt + user content, get back the text block), so a dependency isn't
// worth adding for that. Never import this from a "use client" component —
// it reads the secret key from process.env.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ClaudeImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64Data: string;
}

export interface ClaudeCallOptions {
  system: string;
  userText: string;
  image?: ClaudeImageInput;
  maxTokens?: number;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI features aren't configured yet — an ANTHROPIC_API_KEY is needed on the server.");
    this.name = "AiNotConfiguredError";
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
  maxTokens = 4096,
}: ClaudeCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();

  const content: Record<string, unknown>[] = [];
  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64Data },
    });
  }
  content.push({ type: "text", text: userText });

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API error (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
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
