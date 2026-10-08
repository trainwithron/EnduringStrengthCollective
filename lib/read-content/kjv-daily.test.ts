import { describe, expect, it } from "vitest";
import { KJV_DAILY } from "@/lib/read-content/kjv-daily";

// The bundled readings are public-facing words on a screen people look at between sets. These checks hold the data to the same bar every time it is edited.
describe("KJV_DAILY", () => {
  it("has at least a year of readings", () => {
    expect(KJV_DAILY.length).toBeGreaterThanOrEqual(365);
  });

  it("gives every reading its own reference", () => {
    const seen = new Set<string>();
    for (const item of KJV_DAILY) {
      const key = item.ref.toLowerCase();
      expect(seen.has(key), `duplicate reference ${item.ref}`).toBe(false);
      seen.add(key);
    }
  });

  it("uses a plain book chapter:verse reference", () => {
    const shape = /^(?:[1-3] )?[A-Z][A-Za-z]*(?: [A-Za-z]+)* \d+:\d+(?:-\d+)?$/;
    for (const item of KJV_DAILY) {
      expect(item.ref, item.ref).toMatch(shape);
    }
  });

  it("keeps each reading short enough to read in one rest", () => {
    for (const item of KJV_DAILY) {
      expect(item.text.length, item.ref).toBeGreaterThan(20);
      expect(item.text.length, item.ref).toBeLessThanOrEqual(300);
    }
  });

  it("is plain printable text with no verse numbers", () => {
    for (const item of KJV_DAILY) {
      expect(item.text, item.ref).toMatch(/^[\x20-\x7e]+$/);
      expect(item.text, item.ref).not.toMatch(/^\d/);
      expect(item.text, item.ref).not.toMatch(/\d+:\d+/);
      expect(item.text, item.ref).not.toMatch(/\s{2,}/);
      expect(item.text.trim(), item.ref).toBe(item.text);
    }
  });

  // These are for a screen between sets, mid-effort: encouragement, not rebuke. Passages that turn on judgment, violence or sexual wrongdoing do not belong here.
  // ("wrath" is not on the list: the bundled uses are all about being slow to it, Proverbs 14:29 and 15:1 and James 1:19.)
  it("stays encouraging: no passages about judgment, violence or sexual wrongdoing", () => {
    const banned = /\b(smite|smote|slay|slain|vengeance|hell|abominat\w*|whore\w*|harlot\w*|adulter\w*|fornicat\w*|accursed|cursed)\b/i;
    for (const item of KJV_DAILY) {
      expect(item.text, item.ref).not.toMatch(banned);
    }
  });
});
