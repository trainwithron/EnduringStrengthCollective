import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUMOR_ARCHETYPES } from "@/lib/humor-archetypes";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("nothing a developer wrote reaches a client on the share card", () => {
  it("an archetype carries only a client-facing caption: no second description line exists", () => {
    for (const a of HUMOR_ARCHETYPES) {
      expect(Object.keys(a).sort(), a.key).toEqual(["bodyPaths", "caption", "faceHole", "key"]);
    }
  });
  it("no caption reads like a note to the team", () => {
    for (const a of HUMOR_ARCHETYPES) {
      expect(a.caption, a.key).not.toMatch(/archetype|mechanism|\btone\b|\bsame\b|generic|no real person|placeholder/i);
      expect(a.caption.length).toBeGreaterThan(2);
      expect(a.caption.length).toBeLessThan(40);
    }
  });
  it("the share page shows the caption alone", () => {
    const page = read("app/share/[postId]/page.tsx");
    expect(page).not.toContain("subcaption");
    expect(read("components/share/one-screen-card.tsx")).toContain("{mascot.archetype.caption}");
  });
  it("with no photo the mascot's head shows the person's initial, never an empty dashed circle", () => {
    const card = read("components/share/humor-archetype-card.tsx");
    expect(card).not.toContain("strokeDasharray");
    expect(card).toContain("{firstLetter}");
    expect(read("app/share/[postId]/page.tsx")).toContain('const mascotInitial = shared.athleteName === "An athlete" ? null : shared.athleteName;');
  });
});
