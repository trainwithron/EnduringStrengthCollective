import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_TOO_LONG_MESSAGE, readAiJson } from "@/lib/ai-fetch";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("A slow AI route that the platform cuts off", () => {
  it("a plain-text platform error page becomes a calm message, not a JSON parse error", async () => {
    const cutOff = new Response("An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", { status: 504 });
    expect(await readAiJson(cutOff)).toEqual({ error: AI_TOO_LONG_MESSAGE });
    expect(AI_TOO_LONG_MESSAGE).toBe("That took too long. Try again, or ask for fewer days at a time.");
  });
  it("real JSON answers, successes and errors, come through unchanged", async () => {
    expect(await readAiJson(new Response(JSON.stringify({ rows: [1, 2] }), { status: 200 }))).toEqual({ rows: [1, 2] });
    expect(await readAiJson(new Response(JSON.stringify({ error: "nope" }), { status: 429 }))).toEqual({ error: "nope" });
  });
  it("the program generator ends with our own JSON answer before the platform's limit", () => {
    const route = read("app/api/ai/generate-program/route.ts");
    expect(route).toContain("export const maxDuration = 300;");
    expect(route).toContain("timeoutMs: 280_000");
    expect(route).toContain("err instanceof AiTimeoutError");
    expect(read("lib/anthropic-client.ts")).toContain("AbortSignal.timeout(timeoutMs)");
  });
  it("every slow AI route has a platform limit set, and the screens read answers through the calm reader", () => {
    for (const r of ["generate-program", "program-chat", "generate-meal-plan", "parse-workout", "coach-conversation"]) expect(read(`app/api/ai/${r}/route.ts`)).toMatch(/export const maxDuration = \d+;/);
    for (const c of ["components/coach/desktop/import-wizard.tsx", "components/coach/desktop/program-chat-panel.tsx", "components/coach/desktop/meal-plan-generator.tsx"]) expect(read(c)).toContain("readAiJson(");
  });
});
