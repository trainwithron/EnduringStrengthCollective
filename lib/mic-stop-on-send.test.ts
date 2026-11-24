import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ron, Nov 24: "Submit on the program builder, it should turn the mic off automatically. Because right now it'll just stay recording."
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("sending turns the mic off", () => {
  it("the mic stops on the app-wide stop event and on its form's submit, and drops words that arrive after", () => {
    const mic = read("components/shared/mic-button.tsx");
    expect(mic).toMatch(/export function stopAllMics\(\)/);
    expect(mic).toMatch(/addEventListener\(MIC_STOP_EVENT, stop\)/);
    expect(mic).toMatch(/closest\("form"\)/);
    expect(mic).toMatch(/if \(acceptText\.current\) onTextRef\.current\(text\)/);
  });

  it("the builder's Ask and Resume, Ask why's Explain and the program chat's Send all stop it first", () => {
    const first = (file: string, fn: RegExp) => {
      const src = read(file);
      const at = src.search(fn);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, at + 200)).toMatch(/\{\s*stopAllMics\(\);/);
    };
    first("components/coach/desktop/ai-program-builder-box.tsx", /function ask\(skipProgramCheck = false\)/);
    first("components/coach/desktop/ai-program-builder-box.tsx", /async function resume\(\)/);
    first("components/coach/desktop/ai-run-panel.tsx", /async function explain\(asked\?: string\)/);
    first("components/coach/desktop/program-chat-panel.tsx", /async function handleSend\(\)/);
  });
});
