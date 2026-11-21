import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quietChatSentence, quietInChat, QUIET_CHAT_DAYS, type ChatMessage } from "@/lib/quiet-chat";
import { KIND_ORDER, KIND_SLOT, pickNeedsYou } from "@/lib/needs-you";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const COACH = "coach";
const now = new Date("2026-11-20T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const msg = (from: string, to: string, days: number, group = "g1"): ChatMessage => ({ sender_id: from, recipient_id: to, group_id: group, created_at: ago(days) });
const clients = new Set(["sam", "ana", "bo", "cy", "di"]);

describe("who has gone quiet in chat", () => {
  it("14+ days since the client last wrote, and the coach has written since: flagged, the longest quiet first", () => {
    const out = quietInChat([msg("sam", COACH, 20), msg(COACH, "sam", 10), msg("ana", COACH, 30), msg(COACH, "ana", 2)], COACH, clients, now);
    expect(out.map((q) => [q.athleteId, q.days])).toEqual([
      ["ana", 30],
      ["sam", 20],
    ]);
  });

  it("not flagged: wrote within 14 days; the coach hasn't written since; never wrote to the coach (doesn't use chat)", () => {
    const out = quietInChat(
      [
        msg("sam", COACH, QUIET_CHAT_DAYS - 1), msg(COACH, "sam", 1),
        msg("bo", COACH, 40), msg(COACH, "bo", 41),
        msg(COACH, "cy", 3), msg(COACH, "cy", 30),
      ],
      COACH,
      clients,
      now
    );
    expect(out).toEqual([]);
  });

  it("exactly 14 days counts; only the coach's current clients; messages between other people never count", () => {
    const out = quietInChat([msg("di", COACH, 14), msg(COACH, "di", 1), msg("gone", COACH, 30), msg(COACH, "gone", 1), msg("di", "someone", 1)], COACH, clients, now);
    expect(out.map((q) => q.athleteId)).toEqual(["di"]);
  });

  it("the conversation to answer in is the one the client last wrote in", () => {
    const out = quietInChat([msg("sam", COACH, 40, "g1"), msg("sam", COACH, 20, "g2"), msg(COACH, "sam", 5, "g1")], COACH, clients, now);
    expect(out[0]).toMatchObject({ athleteId: "sam", groupId: "g2", days: 20 });
  });

  it("the sentence follows the name", () => {
    expect(quietChatSentence(18)).toBe("hasn't replied in chat for 18 days. You've messaged since.");
  });
});

describe("in Needs you", () => {
  it("a check-in kind, after the training quiet ones, distinct from them", () => {
    expect(KIND_SLOT.quiet_chat).toBe("slipping");
    expect(KIND_ORDER.indexOf("quiet_chat")).toBe(KIND_ORDER.indexOf("quiet_mild") + 1);
    const view = pickNeedsYou([
      { id: "quietchat:sam", kind: "quiet_chat", name: "Sam Lee", sentence: quietChatSentence(20), button: "Message Sam", href: "/groups/g1/messages/sam", order: -20, nudge: { athleteId: "sam", groupId: "g1", firstName: "Sam" } },
      { id: "quiet:ana", kind: "quiet_mild", name: "Ana", sentence: "hasn't logged in a while.", button: "Check in", href: "/x", order: 0 },
    ]);
    expect(view.slots.find((s) => s.slot === "slipping")?.item?.id).toBe("quiet:ana");
    expect(view.moreCount).toBe(1);
  });

  it("the card's button sends inside Spotlight (Message {name}); one line per client in the panel below, with the same button", () => {
    const strip = src("components/coach/desktop/needs-you-strip.tsx");
    expect(strip).toContain("{item!.nudge && viewer ? (");
    expect(strip).toContain("<QuietClientNudgeButton");
    const data = src("lib/needs-you-data.ts");
    expect(data).toContain('kind: "quiet_chat"');
    expect(data).toContain("byClient.has(q.athleteId)");
    expect(data).toContain('if (chat.failed) failed.push("quiet in chat");');
    const panel = src("components/coach/desktop/quiet-in-chat-panel.tsx");
    expect(panel).toContain("<QuietClientNudgeButton");
    expect(panel).toContain("if (failed || rows.length === 0) return null;");
    const home = src("app/(coach)/dashboard/page.tsx");
    expect(home).toContain("<QuietInChatPanel");
    expect(home).toContain('coachName: viewerProfile?.full_name ?? "Coach",');
  });
});

describe("what counts as the coach writing", () => {
  it("an away auto-reply is not the coach answering: the client is waiting on the coach, not quiet", () => {
    const out = quietInChat([msg("sam", COACH, 20), { ...msg(COACH, "sam", 20), auto_reply: true }], COACH, clients, now);
    expect(out).toEqual([]);
    const real = quietInChat([msg("sam", COACH, 20), { ...msg(COACH, "sam", 20), auto_reply: true }, msg(COACH, "sam", 5)], COACH, clients, now);
    expect(real.map((q) => q.athleteId)).toEqual(["sam"]);
  });
  it("a message sent to everyone at once (a broadcast) is not read as the coach writing to them", () => {
    const q = src("lib/quiet-chat.ts");
    expect(q).toContain('.eq("sender_id", coachId).is("broadcast_batch_id", null)');
    expect(q).toContain("if (fromCoach && m.auto_reply) continue;");
  });
});
