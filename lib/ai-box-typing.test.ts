import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "as soon as I click pause or even before, I should be able to just start typing. It shouldn't gray out the block." The builder chat's text field is never disabled, and Pause answers at once
// (the day already being built finishes in the background; a change or Resume waits for it). Since Nov 24 the builder is one chat (components/coach/desktop/program-builder-chat.tsx).
const box = readFileSync(join(__dirname, "..", "components/coach/desktop/program-builder-chat.tsx"), "utf8").replace(/\r\n/g, "\n");
const textarea = box.slice(box.indexOf("<textarea"), box.indexOf("/>", box.indexOf("<textarea")));

describe("the builder chat's text box while it builds", () => {
  it("is never disabled or grayed", () => {
    expect(textarea).not.toContain("disabled");
    expect(textarea).not.toContain("opacity");
  });
  it("Pause answers at once and does not wait on the day being built", () => {
    const pause = box.slice(box.indexOf("function pause()"), box.indexOf("async function correct("));
    expect(pause).toContain("pauseRequested.current = true;");
    expect(pause).toContain("Pausing after the day I'm on.");
    expect(pause).not.toContain("await");
  });
  it("a change or Resume waits for the day that was in flight before carrying on", () => {
    const correct = box.slice(box.indexOf("async function correct("), box.indexOf("async function resumeNow("));
    expect(correct).toContain("await runPromise.current");
    expect(box.slice(box.indexOf("async function resumeButton()"), box.indexOf("function continueInto("))).toContain('await correct("")');
  });
  it("keeps the strings", () => {
    expect(box).toContain("Paused. Tell me what to change, or press Resume.");
    expect(box).toContain("Nothing reaches the client until you assign it.");
    expect(box).toContain("Change something, or ask why…");
  });
});

describe("the builder builds one week unless asked for more", () => {
  it("stops after the scope and offers the next week once, with a button", () => {
    expect(box).toContain("scopeLimitFrom(said)");
    expect(box).toContain("queue.current = queue.current.filter((s) => s.week <= scope.weeks)");
    expect(box).toContain("Done. It&apos;s in the builder.");
    expect(box).toContain("Want me to carry on into Week {m.week} with the same days?");
    expect(box).toContain("Yes, build Week {m.week}");
  });
  it("never continues by itself: the offered week starts only from the button", () => {
    const afterRun = box.slice(box.indexOf('push({ kind: "offer_week"'), box.indexOf("function startRun("));
    expect(afterRun).not.toContain("runQueue()");
    expect(box).toContain("onClick={() => continueInto(m.week, m.id)}");
  });
});
