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

describe("the AI Program Builder builds one week unless asked for more", () => {
  it("stops after the scope, says so, and offers the next week once with a button", () => {
    expect(box).toContain("scopeLimitFrom(said)");
    expect(box).toContain("queue.current = queue.current.filter((s) => s.week <= scope.weeks)");
    expect(box).toContain("Done. Week ${top} is in the builder.");
    expect(box).toContain("Want me to continue into Week {offerWeek}?");
    expect(box).toContain("Continue into Week {offerWeek}");
  });
  it("never continues by itself: the offered week starts only from the button", () => {
    const afterRun = box.slice(box.indexOf("setOfferWeek(top < 24 ? top + 1 : null)"), box.indexOf("function ask()"));
    expect(afterRun).not.toContain("runQueue()");
    expect(box).toContain("onClick={() => continueInto(offerWeek)}");
  });
});
