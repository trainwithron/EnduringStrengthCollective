import { describe, it, expect } from "vitest";
import { buildCoachInbox, type InboxMessage, type InboxPerson } from "./coach-inbox";

const COACH = "coach";
const people: InboxPerson[] = [
  { id: "johann", fullName: "Johann Gorsek", avatarUrl: null, groupId: "g-johann", groupKind: "one_on_one" },
  { id: "karina", fullName: "Karina Ramirez", avatarUrl: null, groupId: "g-karina", groupKind: "one_on_one" },
  { id: "karina", fullName: "Karina Ramirez", avatarUrl: null, groupId: "g-team", groupKind: "team" },
  { id: "amber", fullName: "Amber", avatarUrl: null, groupId: "g-amber", groupKind: "one_on_one" },
];
function msg(group: string, from: string, to: string, at: string, body = "hi", read: string | null = null): InboxMessage {
  return { group_id: group, sender_id: from, recipient_id: to, body, created_at: at, read_at: read };
}

describe("coach inbox", () => {
  it("shows every client's conversation, not one group's", () => {
    const inbox = buildCoachInbox(people, [msg("g-johann", "johann", COACH, "2026-10-05T10:00:00Z", "hello")], COACH);
    expect(inbox.map((c) => c.otherId).sort()).toEqual(["amber", "johann", "karina"]);
    expect(inbox[0].otherId).toBe("johann");
    expect(inbox[0].unreadCount).toBe(1);
  });
  it("lists a client in two groups once and opens the group of the newest message", () => {
    const inbox = buildCoachInbox(
      people,
      [
        msg("g-karina", "karina", COACH, "2026-10-01T10:00:00Z", "old", "2026-10-01T11:00:00Z"),
        msg("g-team", "karina", COACH, "2026-10-04T10:00:00Z", "newest"),
      ],
      COACH
    );
    const karina = inbox.filter((c) => c.otherId === "karina");
    expect(karina).toHaveLength(1);
    expect(karina[0].groupId).toBe("g-team");
    expect(karina[0].lastBody).toBe("newest");
    expect(karina[0].unreadCount).toBe(1);
  });
  it("opens a client with no messages in their one-on-one group", () => {
    const inbox = buildCoachInbox(people, [], COACH);
    expect(inbox.find((c) => c.otherId === "karina")?.groupId).toBe("g-karina");
  });
  it("ignores messages from groups the client is not in and counts only unread ones sent to the coach", () => {
    const inbox = buildCoachInbox(
      people,
      [
        msg("g-other", "amber", COACH, "2026-10-05T10:00:00Z"),
        msg("g-amber", COACH, "amber", "2026-10-05T11:00:00Z", "sent by coach"),
      ],
      COACH
    );
    const amber = inbox.find((c) => c.otherId === "amber")!;
    expect(amber.unreadCount).toBe(0);
    expect(amber.lastBody).toBe("sent by coach");
  });
});

describe("coach inbox with an away auto-reply", () => {
  const auto = (group: string, from: string, to: string, at: string, body = "I am away"): InboxMessage => ({ ...msg(group, from, to, at, body), auto_reply: true });
  it("a client message followed by the coach's auto-reply is still waiting, and the preview is their message", () => {
    const inbox = buildCoachInbox(
      people,
      [msg("g-johann", "johann", COACH, "2026-10-05T10:00:00Z", "can we move Thursday?", "2026-10-05T10:05:00Z"), auto("g-johann", COACH, "johann", "2026-10-05T10:00:01Z")],
      COACH
    );
    const johann = inbox.find((c) => c.otherId === "johann")!;
    expect(johann.lastFromOther).toBe(true);
    expect(johann.lastBody).toBe("can we move Thursday?");
  });
  it("a real reply from the coach after it clears the waiting", () => {
    const inbox = buildCoachInbox(
      people,
      [
        msg("g-johann", "johann", COACH, "2026-10-05T10:00:00Z", "can we move Thursday?"),
        auto("g-johann", COACH, "johann", "2026-10-05T10:00:01Z"),
        msg("g-johann", COACH, "johann", "2026-10-06T08:00:00Z", "Yes, 5 works"),
      ],
      COACH
    );
    expect(inbox.find((c) => c.otherId === "johann")!.lastFromOther).toBe(false);
  });
  it("a conversation with only an auto-reply has no last message", () => {
    const inbox = buildCoachInbox(people, [auto("g-johann", COACH, "johann", "2026-10-05T10:00:01Z")], COACH);
    expect(inbox.find((c) => c.otherId === "johann")!.lastAt).toBeNull();
  });
});
