import { describe, it, expect } from "vitest";
import {
  computeProgramEndingSuggestions,
  computeSuggestedReminderDate,
  computeMacrosMissingSuggestions,
} from "./coaching-suggestions";

describe("computeProgramEndingSuggestions", () => {
  const today = new Date("2026-09-10T00:00:00");

  it("surfaces an athlete whose program ends within the lead window", () => {
    const result = computeProgramEndingSuggestions(
      [
        {
          athleteId: "a1",
          athleteName: "Alice",
          groupId: "g1",
          groupName: "Iron Standard",
          programEndDate: new Date("2026-09-12T00:00:00"), // 2 days out
        },
      ],
      today,
      3
    );
    expect(result).toHaveLength(1);
    expect(result[0].daysUntilEnd).toBe(2);
    expect(result[0].title).toContain("2 days");
  });

  it("does not surface a program ending further out than the lead window", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-20T00:00:00") }],
      today,
      3
    );
    expect(result).toHaveLength(0);
  });

  it("stops surfacing once the end date has already passed", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-05T00:00:00") }],
      today,
      3
    );
    expect(result).toHaveLength(0);
  });

  it("uses singular phrasing for exactly one day and 'today' for zero", () => {
    const oneDayOut = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-11T00:00:00") }],
      today,
      3
    );
    expect(oneDayOut[0].title).toContain("1 day —");

    const dueToday = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: today }],
      today,
      3
    );
    expect(dueToday[0].title).toContain("ends today");
  });

  it("skips athletes with no scheduled program", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: null }],
      today,
      3
    );
    expect(result).toHaveLength(0);
  });

  it("sorts soonest-ending first", () => {
    const result = computeProgramEndingSuggestions(
      [
        { athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", programEndDate: new Date("2026-09-13T00:00:00") },
        { athleteId: "a2", athleteName: "Ben", groupId: "g1", groupName: "G", programEndDate: new Date("2026-09-10T00:00:00") },
      ],
      today,
      3
    );
    expect(result.map((r) => r.athleteName)).toEqual(["Ben", "Alice"]);
  });
});

describe("computeMacrosMissingSuggestions", () => {
  it("flags a one-on-one client with zero macro days set next week", () => {
    const result = computeMacrosMissingSuggestions([
      { athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", clientTier: "one_on_one", daysWithMacrosNextWeek: 0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain("Alice");
  });

  it("does not flag a client who already has at least one day set", () => {
    const result = computeMacrosMissingSuggestions([
      { athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", clientTier: "online", daysWithMacrosNextWeek: 3 },
    ]);
    expect(result).toHaveLength(0);
  });

  it("never flags a group-tier client, even with zero macro days set", () => {
    const result = computeMacrosMissingSuggestions([
      { athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", clientTier: "group", daysWithMacrosNextWeek: 0 },
    ]);
    expect(result).toHaveLength(0);
  });

  it("flags an unclassified (null tier) client the same as a paying one", () => {
    const result = computeMacrosMissingSuggestions([
      { athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", clientTier: null, daysWithMacrosNextWeek: 0 },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("computeSuggestedReminderDate", () => {
  it("lands lead-days before the end date — a Friday end with 3 days' lead lands on Tuesday", () => {
    const friday = new Date("2026-09-11T00:00:00"); // a Friday
    const result = computeSuggestedReminderDate(friday, 3, new Date("2026-09-08T00:00:00"));
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-08");
  });

  it("falls back to today when the computed date has already passed", () => {
    const endDate = new Date("2026-09-11T00:00:00");
    const today = new Date("2026-09-10T00:00:00"); // later than end-3days
    const result = computeSuggestedReminderDate(endDate, 3, today);
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-10");
  });
});
