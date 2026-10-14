import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstNameOf, isSnoozed, snoozeUntil } from "@/lib/attention-snooze";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: "this needs to be dismissable ... Set 'not now'. 'No macros for Sawyer.'"
describe("Not now hides an item for a week, then it is judged again", () => {
  it("a week from today, hidden through that day and back the day after", () => {
    const today = new Date(2026, 9, 14);
    expect(snoozeUntil(today)).toBe("2026-10-21");
    expect(isSnoozed("2026-10-21", new Date(2026, 9, 14))).toBe(true);
    expect(isSnoozed("2026-10-21", new Date(2026, 9, 21))).toBe(true);
    expect(isSnoozed("2026-10-21", new Date(2026, 9, 22))).toBe(false);
    expect(isSnoozed(null, today)).toBe(false);
  });
  it("month ends roll over", () => {
    expect(snoozeUntil(new Date(2026, 9, 28))).toBe("2026-11-04");
    expect(snoozeUntil(new Date(2026, 11, 28))).toBe("2027-01-04");
  });
  it("the first name for the button", () => {
    expect(firstNameOf("Sawyer Steele")).toBe("Sawyer");
    expect(firstNameOf("  ")).toBe("this client");
  });
});

describe("the Needs attention list", () => {
  const data = read("lib/needs-attention-data.ts");
  const panel = read("components/coach/desktop/needs-attention-panel.tsx");
  it("leaves out items put off for a week and clients whose macros are off, before anything is auto-added", () => {
    expect(data).toContain('!snoozed(s.athleteId, "program_ending")');
    expect(data).toContain('!snoozed(s.athleteId, "macros_missing")');
    expect(data).toContain("a.clientTier !== \"group\" && !a.macrosOff");
    expect(data).toContain("macrosOff: a.coach_sets_macros === false");
    // the activeMacroSuggestions list is what gets auto-added, so a put-off item is never added to the calendar
    expect(data.indexOf("const activeMacroSuggestions")).toBeLessThan(data.indexOf("for (const s of activeMacroSuggestions)"));
  });
  it("still works when the new column is not there yet (the paste is pending)", () => {
    expect(data).toContain("withMacrosSwitch.error");
  });
  it("every item has Not now, the macros item has No macros for [name], and auto-added rows have the controls too", () => {
    expect(panel).toContain("Not now");
    expect(panel).toContain("No macros for {item.firstName ?? firstNameOf(item.title)}");
    expect(panel).toContain('item.triggerKey === "macros_missing" && (');
    expect(panel).toContain("Not now for all");
    // the old permanent Dismiss is gone
    expect(panel).not.toContain("handleDismiss(");
    // the auto-added calendar entry goes with a put-off or switched-off item
    expect(panel).toContain("removeAutoAdded(");
  });
  it("Not now writes a week and No macros writes the switch, as the coach", () => {
    expect(panel).toContain("snoozeUntil(new Date())");
    expect(panel).toContain('from("attention_snoozes").upsert');
    expect(panel).toContain("update({ coach_sets_macros: false })");
  });
  it("the same panel serves desktop Home, the strip, the rail and the phone hub", () => {
    expect(read("components/coach/mobile/coach-home-complications.tsx")).toContain("<NeedsAttentionPanel");
    expect(read("components/coach/desktop/needs-attention-strip.tsx")).toContain("NeedsAttentionPanel");
    expect(read("app/(coach)/groups/[groupId]/dashboard/page.tsx")).toContain("<NeedsAttentionPanel");
  });
  it("the client's Nutrition tab says plainly that macros are off and turns them back on in one tap", () => {
    const toggle = read("components/coach/nutrition/macros-off-toggle.tsx");
    expect(toggle).toContain("Macros are off for {clientFirstName}.");
    expect(toggle).toContain("Turn on");
    expect(toggle).toContain("No macros for {clientFirstName}");
    expect(read("components/coach/nutrition/client-nutrition.tsx")).toContain("<MacrosOffSwitch");
    // it is not the food-tracking switch (whether the client can log food)
    expect(toggle).toContain("coach_sets_macros");
    expect(toggle).not.toContain("food_tracking_enabled");
  });
});
