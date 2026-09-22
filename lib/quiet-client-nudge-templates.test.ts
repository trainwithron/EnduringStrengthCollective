import { describe, it, expect } from "vitest";
import { getQuietClientNudgeTemplates } from "./quiet-client-nudge-templates";

describe("getQuietClientNudgeTemplates", () => {
  it("returns exactly the three resolved templates", () => {
    const templates = getQuietClientNudgeTemplates("Ben");
    expect(templates.map((t) => t.key)).toEqual(["formal", "warm", "casual"]);
  });

  it("interpolates the first name into every template", () => {
    const templates = getQuietClientNudgeTemplates("Karina");
    for (const t of templates) {
      expect(t.text).toContain("Karina");
    }
  });

  it("never appends a guessed honorific or last name", () => {
    const templates = getQuietClientNudgeTemplates("Ben");
    for (const t of templates) {
      expect(t.text).not.toMatch(/Mr\.|Ms\.|Mrs\./);
    }
  });
});
