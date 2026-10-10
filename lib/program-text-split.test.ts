import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitProgramText } from "@/lib/program-text-split";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

const week = (n: number) => `Week ${n}\n` + Array.from({ length: 12 }, (_, i) => `Day ${i + 1}: Back Squat 4x5 @ 70%, Bench Press 3x8, Row 3x10 (note ${n}-${i})`).join("\n");

describe("cutting a long program in two", () => {
  it("too short to cut returns null", () => {
    expect(splitProgramText("Week 1\nSquat 3x5")).toBeNull();
  });
  it("cuts at the start of a week near the middle, and nothing is lost or repeated", () => {
    const text = [1, 2, 3, 4, 5, 6].map(week).join("\n\n");
    const halves = splitProgramText(text)!;
    expect(halves).not.toBeNull();
    expect(halves[1].startsWith("Week ")).toBe(true);
    expect(`${halves[0]}\n\n${halves[1]}`.replace(/\s+/g, " ")).toBe(text.trim().replace(/\s+/g, " "));
    expect(Math.abs(halves[0].length - halves[1].length)).toBeLessThan(text.length * 0.4);
  });
  it("without week markers it cuts at a line break, never inside a line", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Exercise ${i} 3x10 with a long description line to fill space`).join("\n");
    const [a, b] = splitProgramText(text)!;
    expect(a.split("\n").every((l) => l.startsWith("Exercise "))).toBe(true);
    expect(b.split("\n").every((l) => l.startsWith("Exercise "))).toBe(true);
    expect(a.split("\n").length + b.split("\n").length).toBe(80);
  });
  it("one very long line is cut at a space", () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const halves = splitProgramText(text)!;
    expect(halves[0].split(" ").length + halves[1].split(" ").length).toBe(400);
  });
});

describe("a big program is read, not refused", () => {
  const route = read("app/api/ai/parse-workout/route.ts");
  it("a text read gets the big answer budget and, if still cut off, is read in two halves (at most twice over)", () => {
    expect(route).toContain("const READ_MAX_TOKENS = 16000;");
    expect(route).toContain("const MAX_SPLIT_DEPTH = 2;");
    expect(route).toContain("err instanceof AiTruncatedError && depth < MAX_SPLIT_DEPTH");
    expect(route).toContain("splitProgramText(sourceText)");
    expect(route).toContain("parts: a.parts + b.parts");
  });
  it("a picture or scan that is still too big gets a plain message, not 'couldn't read that right now'", () => {
    expect(route).toContain("This program is too large to read in one go. Try a few weeks at a time, or paste the program as text.");
    expect(route).toContain("{ status: 413 }");
  });
  it("the plan carries the readable text so it can be split, and the wizard says it is reading in parts", () => {
    expect(read("lib/program-import-request.ts")).toContain("sourceText: extracted.text");
    const wizard = read("components/coach/desktop/import-wizard.tsx");
    expect(wizard).toContain("This program is large, reading it in parts…");
    expect(wizard).toContain("a large program, read in ${parts} parts");
  });
});
