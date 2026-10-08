import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstLineOf, messagesSynopsis, waitedLabel } from "./messages-synopsis";
import type { InboxConversation } from "./coach-inbox";

const NOW = new Date("2026-10-08T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const conv = (o: Partial<InboxConversation> & { otherId: string }): InboxConversation => ({
  groupId: "g",
  fullName: o.otherId,
  avatarUrl: null,
  lastBody: "hi",
  lastAt: ago(H),
  unreadCount: 0,
  lastFromOther: true,
  ...o,
});

describe("how long someone has waited", () => {
  it("reads as minutes, hours or days", () => {
    expect(waitedLabel(30_000)).toBe("just now");
    expect(waitedLabel(60_000)).toBe("1 minute");
    expect(waitedLabel(25 * 60_000)).toBe("25 minutes");
    expect(waitedLabel(H)).toBe("1 hour");
    expect(waitedLabel(5 * H)).toBe("5 hours");
    expect(waitedLabel(24 * H)).toBe("1 day");
    expect(waitedLabel(50 * H)).toBe("2 days");
  });
});

describe("the first line of what they wrote", () => {
  it("is the first non-empty line", () => {
    expect(firstLineOf("\n\n  Hi coach  \nsecond")).toBe("Hi coach");
    expect(firstLineOf(null)).toBe("");
  });
  it("is cut at a word when long", () => {
    const out = firstLineOf("word ".repeat(40));
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });
});

describe("the messages summary (no AI)", () => {
  it("lists those whose newest message is theirs, longest wait first, with the first line", () => {
    const s = messagesSynopsis(
      [
        conv({ otherId: "ann", fullName: "Ann", lastAt: ago(2 * H), lastBody: "Can we move Friday?\nthanks", unreadCount: 2 }),
        conv({ otherId: "bo", fullName: "Bo", lastAt: ago(50 * H), lastBody: "Sore knee today" }),
        conv({ otherId: "cy", fullName: "Cy", lastAt: ago(H), lastFromOther: false, lastBody: "You: see you then" }),
        conv({ otherId: "di", fullName: "Di", lastAt: null, lastBody: null, lastFromOther: false }),
      ],
      NOW
    );
    expect(s.waiting.map((w) => w.fullName)).toEqual(["Bo", "Ann"]);
    expect(s.waiting[0]).toMatchObject({ waited: "2 days", firstLine: "Sore knee today" });
    expect(s.waiting[1]).toMatchObject({ waited: "2 hours", firstLine: "Can we move Friday?", unread: 2 });
    expect(s.waitingCount).toBe(2);
    expect(s.unreadTotal).toBe(2);
    expect(s.line).toBe("2 are waiting for a reply. The longest wait is Bo (2 days).");
  });
  it("says so plainly for one, none, or no messages at all", () => {
    expect(messagesSynopsis([conv({ otherId: "ann", fullName: "Ann", lastAt: ago(3 * H) })], NOW).line).toBe("Ann is waiting for a reply (3 hours).");
    expect(messagesSynopsis([conv({ otherId: "ann", lastFromOther: false })], NOW).line).toBe("Nobody is waiting for a reply.");
    expect(messagesSynopsis([conv({ otherId: "ann", lastAt: null, lastBody: null, lastFromOther: false })], NOW).line).toBe("No messages yet.");
    expect(messagesSynopsis([], NOW).line).toBe("No messages yet.");
  });
  it("is on the coach's All messages list, above the search, and uses no AI", () => {
    const pane = readFileSync(join(__dirname, "..", "components/messages/messages-two-pane.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(pane.indexOf("<MessagesSynopsisCard")).toBeGreaterThan(-1);
    expect(pane.indexOf("<MessagesSynopsisCard")).toBeLessThan(pane.indexOf('type="search"'));
    const lib = readFileSync(join(__dirname, "messages-synopsis.ts"), "utf8");
    expect(lib).not.toMatch(/anthropic|callClaude|\/api\/ai\//i);
  });
});
