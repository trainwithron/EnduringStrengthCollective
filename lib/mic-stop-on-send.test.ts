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

  it("the builder chat's Send and every tap that sends or acts stop it first", () => {
    const src = read("components/coach/desktop/program-builder-chat.tsx").replace(/\r\n/g, "\n");
    const first = (fn: RegExp) => {
      const at = src.search(fn);
      expect(at, String(fn)).toBeGreaterThan(-1);
      expect(src.slice(at, at + 200), String(fn)).toMatch(/\{\n\s+stopAllMics\(\);/);
    };
    for (const fn of [
      /async function send\(textIn\?: string\)/,
      /function pause\(\)/,
      /async function resumeButton\(\)/,
      /function continueInto\(/,
      /async function goFromPlan\(/,
      /function pickRange\(/,
      /async function applyPreview\(/,
      /function takeChange\(/,
    ])
      first(fn);
    // the plan's Not now, an answer's No thanks, a preview's Not quite, and the Import it / Build from it buttons too
    expect(src).toContain("onNotNow={() => { stopAllMics();");
    expect(src.split("stopAllMics();\n                          patch(m.id, { done: true });")).toHaveLength(5);
    for (const label of ["No thanks", "Not quite", "Import it", "Build from it"]) {
      const at = src.indexOf(`${label}\n`);
      const button = src.slice(src.lastIndexOf("<button", at), at);
      expect(button, label).toContain("stopAllMics();");
    }
  });
});
