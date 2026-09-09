import { describe, it, expect } from "vitest";
import {
  computeProgramEndingSuggestions,
  computeSuggestedReminderDate,
  computeMacrosMissingSuggestions,
  type ReminderRule,
} from "./coaching-suggestions";

const daysBefore = (days: number): ReminderRule => ({ mode: "days_before", days });
const weekdayBefore = (weekday: number): ReminderRule => ({ mode: "weekday_before", weekday });

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
      daysBefore(3)
    );
    expect(result).toHaveLength(1);
    expect(result[0].daysUntilEnd).toBe(2);
    expect(result[0].title).toContain("2 days");
  });

  it("does not surface a program ending further out than the lead window", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-20T00:00:00") }],
      today,
      daysBefore(3)
    );
    expect(result).toHaveLength(0);
  });

  it("stops surfacing once the end date has already passed", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-05T00:00:00") }],
      today,
      daysBefore(3)
    );
    expect(result).toHaveLength(0);
  });

  it("uses singular phrasing for exactly one day and 'today' for zero", () => {
    const oneDayOut = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: new Date("2026-09-11T00:00:00") }],
      today,
      daysBefore(3)
    );
    expect(oneDayOut[0].title).toContain("1 day —");

    const dueToday = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: today }],
      today,
      daysBefore(3)
    );
    expect(dueToday[0].title).toContain("ends today");
  });

  it("skips athletes with no scheduled program", () => {
    const result = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "Iron Standard", programEndDate: null }],
      today,
      daysBefore(3)
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
      daysBefore(3)
    );
    expect(result.map((r) => r.athleteName)).toEqual(["Ben", "Alice"]);
  });

  it("weekday_before: surfaces once today reaches the last matching weekday before the end date", () => {
    // Program ends Friday 2026-09-11. The Friday *before* that is 2026-09-04.
    const endDate = new Date("2026-09-11T00:00:00");
    const beforeReminder = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", programEndDate: endDate }],
      new Date("2026-09-03T00:00:00"),
      weekdayBefore(5) // Friday
    );
    expect(beforeReminder).toHaveLength(0);

    const onReminderDate = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", programEndDate: endDate }],
      new Date("2026-09-04T00:00:00"),
      weekdayBefore(5)
    );
    expect(onReminderDate).toHaveLength(1);
  });

  it("weekday_before: a program ending ON the target weekday still waits a full week, not zero days", () => {
    const endDate = new Date("2026-09-11T00:00:00"); // a Friday
    const sameDayAsFridayRule = computeProgramEndingSuggestions(
      [{ athleteId: "a1", athleteName: "Alice", groupId: "g1", groupName: "G", programEndDate: endDate }],
      endDate,
      weekdayBefore(5) // Friday — end date itself is a Friday
    );
    // Reminder date resolves to the *previous* Friday (2026-09-04), so
    // "today" being the end date itself is still within the active window.
    expect(sameDayAsFridayRule).toHaveLength(1);
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
    const result = computeSuggestedReminderDate(friday, daysBefore(3), new Date("2026-09-08T00:00:00"));
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-08");
  });

  it("falls back to today when the computed date has already passed", () => {
    const endDate = new Date("2026-09-11T00:00:00");
    const today = new Date("2026-09-10T00:00:00"); // later than end-3days
    const result = computeSuggestedReminderDate(endDate, daysBefore(3), today);
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("weekday_before: resolves to the most recent matching weekday strictly before the end date", () => {
    const endDate = new Date("2026-09-11T00:00:00"); // Friday
    const result = computeSuggestedReminderDate(endDate, weekdayBefore(5), new Date("2026-09-01T00:00:00"));
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-04"); // the prior Friday
    expect(result.getDay()).toBe(5);
  });

  it("weekday_before: falls back to today when the resolved date has already passed", () => {
    const endDate = new Date("2026-09-11T00:00:00");
    const today = new Date("2026-09-06T00:00:00"); // after 2026-09-04
    const result = computeSuggestedReminderDate(endDate, weekdayBefore(5), today);
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-06");
  });
});
