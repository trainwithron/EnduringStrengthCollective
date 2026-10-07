import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The card must fit the visible screen with nothing scrolling inside it. The real measurements (no overflow at 360x560,
// 360x640, 390x844 and 412x915) were taken in a browser; this guards the rules that make that true so a later edit
// cannot quietly bring an inner scroll or a fixed pixel height back.
const source = readFileSync(new URL("./one-screen-card.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/share/[postId]/page.tsx", import.meta.url), "utf8");

describe("one-screen card rules", () => {
  it("sizes from the visible screen height and has no inner scroll", () => {
    expect(source).toContain("dvh");
    expect(source).not.toMatch(/overflow-(y-)?(auto|scroll)/);
    expect(source).toContain("overflow-hidden");
  });
  it("drops the least important lines on a short screen instead of overflowing", () => {
    expect(source).toContain("max-height:620px");
    expect(source).toContain("max-height:700px");
  });
  it("never uses a fixed pixel height for the card", () => {
    expect(source).not.toMatch(/\bh-\[\d+px\]/);
  });
  it("shows the fun line without a fixed height, drops it on a very short screen, and offers Another one only when given a handler", () => {
    expect(source).toContain("model.funLine");
    expect(source).toContain("line-clamp-2");
    expect(source).toContain("max-height:600px");
    expect(source).toContain("onShuffle &&");
    expect(source).toContain("min-h-[2.75rem]");
  });
  it("the fun line is fresh per card and remembered on the client's device, and the picture follows the same line", () => {
    const screen = readFileSync(new URL("./share-screen.tsx", import.meta.url), "utf8");
    expect(screen).toContain("pickFreshFunLine(facts, memory.recent)");
    expect(screen).toContain("rerollFunLine(facts, memory.recent, line.id)");
    expect(screen).toContain("funLine: line.text");
    expect(screen).toContain("isOwner && !!viewerId");
    expect(page).toContain("<ShareScreen");
    expect(page).toContain("pickSeededFunLine(funFacts, params.postId)");
  });
  it("the page gives the card the visible screen and keeps the rest below it", () => {
    expect(page).toContain("h-[100dvh]");
    expect(page).toContain("env(safe-area-inset-bottom)");
    expect(page).toContain('id="full-workout"');
  });
});
