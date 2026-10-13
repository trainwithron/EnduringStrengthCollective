import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "as soon as I click pause or even before, I should be able to just start typing. It shouldn't gray out the block." The AI box's text field is never disabled, and Pause shows at once
// (the day already being built finishes in the background; Resume waits for it).
const box = readFileSync(join(__dirname, "..", "components/coach/desktop/ai-program-builder-box.tsx"), "utf8").replace(/\r\n/g, "\n");
const textarea = box.slice(box.indexOf("<textarea"), box.indexOf("/>", box.indexOf("<textarea")));

describe("the AI Program Builder text box while it builds", () => {
  it("is never disabled or grayed", () => {
    expect(textarea).not.toContain("disabled");
    expect(textarea).not.toContain("opacity");
  });
  it("Pause shows paused at once and does not wait on the day being built", () => {
    const pause = box.slice(box.indexOf("function pause()"), box.indexOf("async function resume()"));
    expect(pause).toContain('setPhase("paused")');
    expect(pause).not.toContain("await");
  });
  it("Resume waits for the day that was in flight before carrying on", () => {
    const resume = box.slice(box.indexOf("async function resume()"), box.indexOf("async function resumeNow()"));
    expect(resume).toContain("await runPromise.current");
  });
  it("keeps the strings", () => {
    expect(box).toContain("Paused. Tell it what to change, then Resume.");
    expect(box).toContain("Saved as you go. Nothing reaches the client until you assign it.");
    expect(box).toContain("What should it change?");
  });
});
