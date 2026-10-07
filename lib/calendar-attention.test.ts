import { describe, it, expect } from "vitest";
import { attentionPage, buildAttentionItems, programAttentionKey, quietLabel, snoozeRows, snoozedAttentionKeys, visibleAttention } from "./calendar-attention";
import { quietSnoozeKey } from "./quiet-snooze";

const input = {
  groupId: "g1",
  programsWithNoWorkouts: [{ id: "p1", name: "Block 1", athleteName: null }],
  programsMissingSchedule: [{ id: "p2", name: "Block 2", athleteName: "Alice" }],
  clientsWithNoProgram: [{ profileId: "a3", fullName: "Cara", groupId: "g9" }],
  quietClients: [
    { profileId: "a4", fullName: "Amber Belt", groupId: "g4", tier: "strong" as const, neverLogged: true },
    { profileId: "a5", fullName: "Ben", groupId: "g5", tier: "strong" as const, neverLogged: false },
    { profileId: "a6", fullName: "Dee", groupId: "g6", tier: "mild" as const, neverLogged: false },
  ],
};

describe("the calendar's attention rows", () => {
  it("builds one row for each item, with the right place to open", () => {
    const items = buildAttentionItems(input);
    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({ key: programAttentionKey("empty", "p1"), href: "/groups/g1/programs/p1" });
    expect(items[1].label).toBe("“Block 2” (Alice) needs a start date to show on the calendar");
    expect(items[2].href).toBe("/groups/g9/athletes/a3");
  });
  it("says a client who never trained has not started, not that they went quiet", () => {
    const labels = buildAttentionItems(input).map((i) => i.label);
    expect(labels).toContain("Amber Belt hasn't done a first workout yet");
    expect(labels).toContain("Ben has gone quiet — worth a personal check-in");
    expect(labels).toContain("Dee hasn't logged in a while");
    expect(quietLabel("strong", true)).toBe("hasn't done a first workout yet");
  });
  it("shares Home's snooze key for a quiet client, so a snooze in either place quiets both", () => {
    const items = buildAttentionItems(input);
    const amber = items.find((i) => i.subject === "Amber Belt")!;
    expect(amber.key).toBe(quietSnoozeKey("a4", "g4"));
    expect(amber.snoozeKind).toBe("quiet_client");
    expect(items.find((i) => i.subject === "Block 1")!.snoozeKind).toBe("calendar_attention");
  });
  it("hides what is snoozed and brings it back after a week", () => {
    const items = buildAttentionItems(input);
    const now = new Date("2026-10-10T12:00:00Z");
    const snoozed = snoozedAttentionKeys(
      [
        { dismissal_key: quietSnoozeKey("a4", "g4"), created_at: "2026-10-08T12:00:00Z" },
        { dismissal_key: programAttentionKey("empty", "p1"), created_at: "2026-10-09T12:00:00Z" },
        { dismissal_key: quietSnoozeKey("a5", "g5"), created_at: "2026-10-01T12:00:00Z" },
        { dismissal_key: "something::else", created_at: "2026-10-09T12:00:00Z" },
      ],
      now
    );
    expect(snoozed.size).toBe(2);
    const left = visibleAttention(items, snoozed).map((i) => i.subject);
    expect(left).not.toContain("Amber Belt");
    expect(left).not.toContain("Block 1");
    expect(left).toContain("Ben");
  });
  it("snoozing writes one feedback row per item with the right kind", () => {
    const rows = snoozeRows("coach-1", buildAttentionItems(input).slice(0, 1));
    expect(rows).toEqual([
      { coach_id: "coach-1", spotter_kind: "calendar_attention", dismissal_key: programAttentionKey("empty", "p1"), option_summary: "Block 1: needs attention, snoozed 7 days", action: "denied" },
    ]);
  });
  it("shows three at a time", () => {
    const items = buildAttentionItems(input);
    expect(attentionPage(items, 0)).toMatchObject({ remaining: 3 });
    expect(attentionPage(items, 0).shown).toHaveLength(3);
    expect(attentionPage(items, 1)).toMatchObject({ remaining: 0 });
    expect(attentionPage([], 0)).toEqual({ shown: [], remaining: 0 });
  });
});
