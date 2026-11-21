import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { filterConversations, unreadFirst, panelSections, withPinnedClient, selectedConversation, totalUnread, clientIdFromPath, URGENT_NOTICE_TYPES } from "@/lib/messages-list";
import { buildCoachInbox, type InboxConversation } from "@/lib/coach-inbox";

const c = (otherId: string, fullName: string, o: Partial<InboxConversation> = {}): InboxConversation => ({
  otherId,
  groupId: "g1",
  fullName,
  avatarUrl: null,
  lastBody: null,
  lastAt: null,
  unreadCount: 0,
  lastFromOther: false,
  ...o,
});

const LIST = [
  c("w", "William Stafford", { unreadCount: 2, lastAt: "2026-10-08T10:00:00Z", lastBody: "Can I move Friday?", lastFromOther: true }),
  c("k", "Karina Ramirez", { lastAt: "2026-10-08T09:00:00Z", lastBody: "Thanks!", lastFromOther: true }),
  c("a", "Amber Cole", { lastAt: "2026-10-07T09:00:00Z", lastBody: "See you then", lastFromOther: false }),
  c("r", "Robyn Wells"),
];

describe("searching the conversation list", () => {
  it("every word typed must start a word of the name, in any order", () => {
    expect(filterConversations(LIST, "wil staf").map((x) => x.otherId)).toEqual(["w"]);
    expect(filterConversations(LIST, "stafford william").map((x) => x.otherId)).toEqual(["w"]);
    expect(filterConversations(LIST, "RAM").map((x) => x.otherId)).toEqual(["k"]);
  });
  it("empty search keeps the list, a miss gives none", () => {
    expect(filterConversations(LIST, "  ")).toBe(LIST);
    expect(filterConversations(LIST, "zzz")).toEqual([]);
  });
});

describe("order and the unread count", () => {
  it("unread first, then the newest", () => {
    expect(unreadFirst(LIST).map((x) => x.otherId)).toEqual(["w", "k", "a", "r"]);
    expect(totalUnread(LIST)).toBe(2);
  });
  it("the floating panel puts the pressing items first: unread, then clients waiting on a reply, then everyone else", () => {
    const s = panelSections(LIST);
    expect(s.unread.map((x) => x.otherId)).toEqual(["w"]);
    expect(s.waiting.map((x) => x.otherId)).toEqual(["k"]);
    expect(s.others.map((x) => x.otherId)).toEqual(["a", "r"]);
  });
  it("the inbox builder marks whose message is the newest", () => {
    const people = [{ id: "k", fullName: "Karina", avatarUrl: null, groupId: "g1", groupKind: "one_on_one" as const }];
    const fromClient = buildCoachInbox(people, [{ group_id: "g1", sender_id: "k", recipient_id: "coach", body: "hi", created_at: "2026-10-08T10:00:00Z", read_at: "x" }], "coach");
    expect(fromClient[0].lastFromOther).toBe(true);
    const answered = buildCoachInbox(
      people,
      [
        { group_id: "g1", sender_id: "k", recipient_id: "coach", body: "hi", created_at: "2026-10-08T10:00:00Z", read_at: "x" },
        { group_id: "g1", sender_id: "coach", recipient_id: "k", body: "hello", created_at: "2026-10-08T10:05:00Z", read_at: null },
      ],
      "coach"
    );
    expect(answered[0].lastFromOther).toBe(false);
  });
});

describe("the client being looked at", () => {
  it("is pinned to the top and labelled, but only pinned (never opened)", () => {
    const r = withPinnedClient(LIST, "a");
    expect(r.pinnedId).toBe("a");
    expect(r.list.map((x) => x.otherId)).toEqual(["a", "w", "k", "r"]);
  });
  it("on any other page, or for someone with no conversation, nothing is pinned and the order is unchanged", () => {
    expect(withPinnedClient(LIST, null)).toEqual({ list: LIST, pinnedId: null });
    expect(withPinnedClient(LIST, "stranger")).toEqual({ list: LIST, pinnedId: null });
  });
  it("the client comes from the page address on a profile page only", () => {
    expect(clientIdFromPath("/groups/g1/athletes/abc-123")).toBe("abc-123");
    expect(clientIdFromPath("/groups/g1/athletes/abc-123/calendar")).toBe("abc-123");
    expect(clientIdFromPath("/groups/g1/clients")).toBeNull();
    expect(clientIdFromPath("/groups/g1/messages")).toBeNull();
    expect(clientIdFromPath("/dashboard")).toBeNull();
    expect(clientIdFromPath(null)).toBeNull();
  });
});

describe("?with= on the All messages page", () => {
  it("preselects a real conversation, ignores anything else", () => {
    expect(selectedConversation(LIST, "k")?.fullName).toBe("Karina Ramirez");
    expect(selectedConversation(LIST, "not-a-client")).toBeNull();
    expect(selectedConversation(LIST, null)).toBeNull();
    expect(selectedConversation(LIST, undefined)).toBeNull();
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\r\n/g, "\n");

describe("the All messages page", () => {
  const page = read("../app/(coach)/groups/[groupId]/messages/page.tsx");
  const pane = read("../components/messages/messages-two-pane.tsx");
  it("a coach on a computer gets the two-pane inbox, preselected by ?with= and carrying a drafted note", () => {
    expect(page).toContain("<MessagesTwoPane");
    expect(page).toContain("selectedConversation(conversations, search.with)");
    expect(page).toContain('(search.draft ?? "").slice(0, 600)');
    // the page is called Messages, like its tab (clutter audit DK30, Nov 21)
    expect(page).toContain('uppercase leading-none">Messages</h1>');
  });
  it("picking a row opens the thread in place: no navigation, the address kept with replaceState so Back leaves the page", () => {
    expect(pane).toContain("window.history.replaceState");
    expect(pane).not.toContain("router.push");
    expect(pane).not.toContain("<Link href={`/groups/${c.groupId}/messages");
    expect(pane).toContain("<ThreadPane");
  });
  it("clicking the client's name opens their profile", () => {
    expect(pane).toContain("/athletes/${selected.otherId}");
  });
  it("the phone and the client keep their own lists", () => {
    expect(page).toContain("CoachMobileShell");
    expect(page).toContain("ConversationLink");
  });
  it("the workspace card for a client's messages is the light two-pane page, not the whole profile", () => {
    expect(read("./workspace-destinations.ts")).toContain("`${base}/messages?with=${client.athleteId}`");
  });
});

describe("opening a thread in place is the 'seen it' moment, and only when it is on screen", () => {
  const route = read("../app/api/messages/thread/route.ts");
  const thread = read("../components/messages/thread-pane.tsx");
  const inbox = read("../app/api/messages/inbox/route.ts");
  const panel = read("../components/coach/desktop/collective-intelligence-chat.tsx");
  it("the thread route needs a signed-in coach of that group and an athlete of that group, and loads (and so marks read) only then", () => {
    expect(route).toContain("status: 401");
    expect(route).toContain('mine?.role !== "coach" || theirs?.role !== "athlete"');
    expect(route.indexOf("status: 404")).toBeLessThan(route.indexOf("loadDirectThread("));
  });
  it("the list route only reads: it never calls the loader that marks messages read", () => {
    expect(inbox).not.toContain("loadDirectThread");
    expect(inbox).not.toMatch(/\.update\(/);
    expect(inbox).toContain(".is(\"read_at\", null)");
  });
  it("the thread loads when its pane mounts, not before", () => {
    expect(thread).toContain("\"/api/messages/thread\"");
    expect(thread).toContain("method: \"POST\"");
    expect(thread).toContain("useEffect");
  });
  it("Ask Spot is Spot only (clutter audit DK18, Nov 21): no Messages tab, no unread badge of its own; messages are on the Messages page and the rail's count", () => {
    expect(panel).not.toContain("FloatingMessages");
    expect(panel).not.toContain('"messages"');
    expect(panel).not.toMatch(/unreadNow|unread =|badgeText/);
    expect(panel).toContain("<AskSpotChatPanel />");
    expect(read("../components/coach/coach-desktop-shell.tsx")).toContain("<CollectiveIntelligenceChat />");
    expect(URGENT_NOTICE_TYPES).toContain("schedule_request");
    expect(URGENT_NOTICE_TYPES).toContain("late_change");
  });
});

describe("the inbox is read in full and kept fresh (Assistant's review)", () => {
  const data = read("./coach-inbox-data.ts");
  const route = read("../app/api/messages/thread/route.ts");
  const refresh = read("../components/messages/use-inbox-refresh.ts");
  it("the messages are read a page at a time, in a fixed order, and a failed or cut-off read is reported", () => {
    expect(data).toContain("readByIds(scopeIds");
    expect(data).toContain('.order("created_at", { ascending: true })');
    expect(data).toContain('.order("id", { ascending: true })');
    expect(data).toContain("incomplete: messagePages.failed || messagePages.truncated");
    expect(read("../app/api/messages/inbox/route.ts")).toContain("incomplete,");
    expect(read("../app/(coach)/groups/[groupId]/messages/page.tsx")).toContain("incomplete={incomplete}");
    expect(read("../components/messages/messages-two-pane.tsx")).toContain("could not be loaded");
  });
  it("the thread route is a POST that is never cached", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route.match(/headers: NO_STORE/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("the list refreshes every 45 seconds, only while the tab is in front, through the read-only route", () => {
    expect(refresh).toContain("INBOX_REFRESH_MS = 45_000");
    expect(refresh).toContain('document.visibilityState !== "visible"');
    expect(refresh).toContain("/api/messages/inbox?groupId=");
    expect(read("../components/messages/messages-two-pane.tsx")).toContain("useInboxRefresh(");
  });
});
