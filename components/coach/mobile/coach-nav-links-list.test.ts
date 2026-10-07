import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The phone More list is short on purpose. These guard the shape Ron asked for so a later edit cannot quietly bring the
// 30-item drawer or the group switcher back.
const source = readFileSync(new URL("./coach-nav-links-list.tsx", import.meta.url), "utf8");
const open = source.slice(0, source.indexOf("<details"));
const tools = source.slice(source.indexOf("<details"));

describe("phone More list", () => {
  it("keeps the daily items in the open list", () => {
    for (const label of [
      "Programs",
      "Exercise library",
      "Nutrition",
      "Availability",
      "Business overview",
      "Settings",
      "Desktop mode",
    ]) {
      expect(open, label).toContain(label);
    }
  });
  it("has one Nutrition item, not separate meal plan, recipe and calculator entries", () => {
    for (const old of ["Recipe hub", "Meal plans", "Macro calculator"]) expect(source, old).not.toContain(old);
  });
  it("puts the rarely used tools behind a closed More tools section", () => {
    expect(source).toContain("More tools");
    expect(tools).not.toContain("<details open");
    for (const label of ["Packages", "Waiver", "Zapier", "Session ledger", "Challenges", "Kiosk display", "Quick tips"]) {
      expect(tools, label).toContain(label);
      expect(open, label).not.toContain(label);
    }
  });
  it("no longer carries the group switcher or the confusing Phone layout and Display Mode labels", () => {
    expect(source).not.toContain("GroupSwitcher");
    expect(source).not.toContain("Phone layout");
    expect(source).not.toContain("Display Mode");
  });
  it("uses sentence-case labels", () => {
    expect(source).not.toMatch(/label="[A-Z][a-z]+ [A-Z][a-z]+"/);
  });
});
