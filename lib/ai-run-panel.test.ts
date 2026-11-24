import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitChange } from "@/lib/explain-program";

// "What you asked for" and "Ask why" used to sit beside the builder. Since Nov 24 they are the builder chat itself: what he asked for is his own messages in the thread, and a why-question
// is answered in the thread. An answer can offer a change; taking it shows the change first (nothing is written by the answer).
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const chat = read("components/coach/desktop/program-builder-chat.tsx");
const route = read("app/api/ai/explain-program/route.ts");

describe("asking why, in the thread", () => {
  it("his request and each change show as his own messages, in order; there is no separate panel", () => {
    expect(chat).toContain('push({ kind: "coach", text: said });');
    expect(chat).not.toContain("AiRunPanel");
    expect(read("components/coach/desktop/program-builder-desktop.tsx")).not.toContain("AiRunPanel");
  });
  it("a why-question is answered in the thread with the earlier answers, and an offered change goes to its preview first", () => {
    expect(chat).toContain('if (intent === "why") {\n        await explain(said);');
    expect(chat).toContain("thread: whyThread.current");
    expect(chat).toContain("Couldn't answer that. Try again.");
    expect(chat).toContain("I&apos;ll show the change first.");
    const take = chat.slice(chat.indexOf("function takeChange("), chat.indexOf("// ---- one send ----"));
    expect(take).toContain("askEdit(msg.change)");
    expect(take).toContain("rebuildTurn(msg.change, target)");
    expect(take).not.toContain("fetch(");
  });
  it("the route only explains: coach-only, one short call counted with the program chat, no writes", () => {
    expect(route).toContain('membership?.role !== "coach"');
    expect(route).toContain('feature: "program_chat"');
    expect(route).toContain("aiInputTooLong");
    expect(route).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(route).toContain("const { answer: said, change } = splitChange(answer);");
    expect(readFileSync(join(__dirname, "..", "lib/explain-program.ts"), "utf8")).toContain("you only explain");
  });
});

describe("the change an answer offers", () => {
  it("is the first CHANGE line, taken out of the answer", () => {
    expect(splitChange("Two presses keep the volume up.\nCHANGE: swap the second press on Day 1 for a row")).toEqual({ answer: "Two presses keep the volume up.", change: "swap the second press on Day 1 for a row" });
    expect(splitChange("Because it is a heavy day.")).toEqual({ answer: "Because it is a heavy day.", change: null });
    expect(splitChange("Answer.\nCHANGE: one\nCHANGE: two")).toEqual({ answer: "Answer.", change: "one" });
    expect(splitChange("Answer.\nCHANGE:   ").change).toBeNull();
    expect(splitChange("A.\nCHANGE: " + "x".repeat(400)).change).toHaveLength(300);
  });
});
