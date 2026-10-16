import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron: "I have a mic on my desktop but I can't do voice to text without that button." The AI Program Builder text box (which is also the correction box while paused) and the Ask why box each get
// the shared mic button: tap to start, tap again to stop, what is said is added to the text.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const box = read("components/coach/desktop/ai-program-builder-box.tsx");
const panel = read("components/coach/desktop/ai-run-panel.tsx");
const mic = read("components/shared/mic-button.tsx");

describe("voice typing in the AI Program Builder", () => {
  it("the builder box and the Ask why box both have the mic, appending what is said", () => {
    for (const src of [box, panel]) {
      expect(src).toContain('import { MicButton } from "@/components/shared/mic-button";');
      expect(src).toContain('startLabel="Start voice typing"');
      expect(src).toContain('stopLabel="Stop voice typing"');
      expect(src).toContain("continuous");
      expect(src).toContain("Voice typing isn't available in this browser");
    }
    expect(box).toContain("setText((x) => (x.trim() ?");
    expect(panel).toContain("setQuestion((x) => (x.trim() ?");
  });
  it("the mic shows it is recording, names its two states, and keeps listening until tapped again", () => {
    expect(mic).toContain("animate-pulse");
    expect(mic).toContain("stopLabel ??");
    expect(read("lib/mic-session.ts")).toContain("next.continuous = continuous");
  });
  it("only the newly heard words are added, so a long dictation is not repeated", () => {
    expect(read("lib/mic-session.ts")).toContain("e.resultIndex ?? 0");
  });
  it("a browser with no speech support gets a quiet disabled button with the plain tooltip, not a broken one", () => {
    expect(mic).toContain("disabled title={unsupportedHint}");
  });
  it("the other places that use the mic are unchanged (no new props needed)", () => {
    for (const p of ["components/coach/coach-conversation.tsx", "components/coach/desktop/program-chat-panel.tsx", "components/coach/learned-suggestion-card.tsx"]) {
      expect(read(p)).not.toContain("continuous");
    }
  });
});
