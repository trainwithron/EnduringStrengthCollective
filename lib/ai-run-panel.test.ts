import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Beside the AI Program Builder: what he asked for (read-only) and "Ask why", which only explains.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const panel = read("components/coach/desktop/ai-run-panel.tsx");
const route = read("app/api/ai/explain-program/route.ts");
const box = read("components/coach/desktop/ai-program-builder-box.tsx");

describe("the prompt panel and Ask why", () => {
  it("shows his request and each change in order, collapsible and read-only, hidden before the first Ask", () => {
    expect(panel).toContain("What you asked for");
    expect(panel).toContain("Changes you asked for");
    expect(panel).toContain("<details open>");
    expect(panel).toContain("if (!request) return null;");
    expect(panel).not.toContain("<textarea\n          value={request}");
    expect(box).toContain("<AiRunPanel programId={programId} request={shownRequest} corrections={shownCorrections} />");
    expect(box).toContain("setShownCorrections([...corrections.current])");
  });
  it("uses the approved strings", () => {
    expect(panel).toContain("Ask why");
    expect(panel).toContain("Ask why it did something, for example: why two presses on Day 1?");
    expect(panel).toContain("Explain");
    expect(panel).toContain("It only explains. It changes nothing unless you ask.");
    expect(panel).toContain("Couldn't answer that. Try again.");
  });
  it("the route only explains: coach-only, one short call counted with the program chat, no writes", () => {
    expect(route).toContain('membership?.role !== "coach"');
    expect(route).toContain('feature: "program_chat"');
    expect(route).toContain("aiInputTooLong");
    expect(route).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(route).toContain("you only explain");
  });
});
