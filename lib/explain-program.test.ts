import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AiTruncatedError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { EXPLAIN_MAX_TOKENS, EXPLAIN_STRICT_NOTE, EXPLAIN_SYSTEM_PROMPT, answerConcisely } from "@/lib/explain-program";

// Live bug (Oct 16): "Ask why" said "Couldn't answer that. Try again." The log showed status truncated at exactly the 500 token cap.
describe("Ask why answers", () => {
  it("a good first reply is shown, with one call", async () => {
    const calls: boolean[] = [];
    const out = await answerConcisely(async (strict) => {
      calls.push(strict);
      return "  Day 2 repeats the squat because you asked for two squat days.  ";
    });
    expect(out).toBe("Day 2 repeats the squat because you asked for two squat days.");
    expect(calls).toEqual([false]);
  });
  it("a long (cut-off) first reply triggers exactly one stricter retry, and only the retry is shown", async () => {
    const calls: boolean[] = [];
    const out = await answerConcisely(async (strict) => {
      calls.push(strict);
      if (!strict) throw new AiTruncatedError();
      return "It follows your request. Want me to change it?";
    });
    expect(out).toBe("It follows your request. Want me to change it?");
    expect(calls).toEqual([false, true]);
  });
  it("an empty reply errors (null) after the one retry", async () => {
    const calls: boolean[] = [];
    expect(await answerConcisely(async (s) => (calls.push(s), "   "))).toBeNull();
    expect(calls).toEqual([false, true]);
  });
  it("still cut off on the retry: null, never cut-off text", async () => {
    let n = 0;
    expect(await answerConcisely(async () => { n++; throw new AiTruncatedError(); })).toBeNull();
    expect(n).toBe(2);
  });
  it("other failures are not retried and are thrown for the route to report", async () => {
    let n = 0;
    await expect(answerConcisely(async () => { n++; throw new AiRateLimitedError("burst"); })).rejects.toBeInstanceOf(AiRateLimitedError);
    expect(n).toBe(1);
  });
});

describe("the prompt", () => {
  it("asks for the one real reason in at most 3 short sentences, or a plain admission with a one-line fix, and still never changes the program", () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("at most 3 short sentences, under about 70 words");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("I don't have a good reason for that. It doesn't follow from what you asked.");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("Want me to change it?");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("a repeated exercise");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("Do NOT change anything yourself");
    expect(EXPLAIN_STRICT_NOTE).toContain("two short sentences");
    expect(EXPLAIN_MAX_TOKENS).toBeGreaterThanOrEqual(800);
  });
  it("the route uses it, with a single retry path and no trimming of cut-off text", () => {
    const route = readFileSync(join(__dirname, "..", "app/api/ai/explain-program/route.ts"), "utf8");
    expect(route).toContain("answerConcisely");
    expect(route).toContain("settings.maxTokens");
    expect(route).not.toContain("maxTokens: 500");
  });
});

import { EXPLAIN_FOLLOWUP_MAX_TOKENS, EXPLAIN_FOLLOWUP_SYSTEM_PROMPT, EXPLAIN_MAX_EXCHANGES, cleanThread, explainSettings, threadText } from "@/lib/explain-program";

describe("Tell me more (follow-up)", () => {
  it("the first question gets the concise prompt and allowance; once there is an exchange, the deeper prompt and a higher allowance", () => {
    const first = explainSettings([], false);
    expect(first.system).toBe(EXPLAIN_SYSTEM_PROMPT);
    expect(first.maxTokens).toBe(EXPLAIN_MAX_TOKENS);
    const deeper = explainSettings([{ question: "why?", answer: "Because." }], false);
    expect(deeper.system).toBe(EXPLAIN_FOLLOWUP_SYSTEM_PROMPT);
    expect(deeper.maxTokens).toBe(EXPLAIN_FOLLOWUP_MAX_TOKENS);
    expect(EXPLAIN_FOLLOWUP_MAX_TOKENS).toBeGreaterThanOrEqual(1200);
    expect(EXPLAIN_FOLLOWUP_SYSTEM_PROMPT).toContain("I don't have a good reason for that");
    expect(EXPLAIN_FOLLOWUP_SYSTEM_PROMPT).toContain("Do NOT change anything yourself");
  });
  it("the retry after a cut-off is stricter in both modes", () => {
    expect(explainSettings([], true).system).toContain("two short sentences");
    expect(explainSettings([{ question: "q", answer: "a" }], true).system).toContain("no more than four sentences");
  });
  it("the follow-up carries the earlier exchange, the thread is capped, and bad entries are dropped", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const t = cleanThread([...many, { question: 5, answer: "x" }, null, { question: "  ", answer: "x" }]);
    expect(t).toHaveLength(EXPLAIN_MAX_EXCHANGES);
    expect(t[0].question).toBe("q3");
    expect(t[t.length - 1].question).toBe("q8");
    expect(threadText(t.slice(-1))).toBe("Coach asked: q8\nYou answered: a8");
    expect(cleanThread("nope")).toEqual([]);
  });
  it("the panel keeps the thread in itself only, offers Tell me more, and sends it with the question; the route uses the thread", () => {
    const panel = readFileSync(join(__dirname, "..", "components/coach/desktop/ai-run-panel.tsx"), "utf8");
    expect(panel).toContain("Tell me more");
    expect(panel).toContain("Start over");
    expect(panel).toContain("thread })");
    expect(panel).not.toContain("localStorage");
    const route = readFileSync(join(__dirname, "..", "app/api/ai/explain-program/route.ts"), "utf8");
    expect(route).toContain("cleanThread(body.thread)");
    expect(route).toContain("Earlier in this conversation:");
  });
});
