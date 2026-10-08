import type { InboxConversation } from "@/lib/coach-inbox";

// How a list of conversations is searched and put in order (pure), shared by the All messages page and the floating panel.

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

// Search by the client's name: every word typed must start a word of the name (so "wil staf" finds William Stafford). Empty search keeps the list as it is.
export function filterConversations(conversations: InboxConversation[], query: string): InboxConversation[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return conversations;
  return conversations.filter((c) => {
    const nameWords = norm(c.fullName).split(" ");
    return words.every((w) => nameWords.some((n) => n.startsWith(w)));
  });
}

// Unread first (most unread, then newest), as the inbox already orders them.
export function unreadFirst(conversations: InboxConversation[]): InboxConversation[] {
  return [...conversations].sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

export function totalUnread(conversations: InboxConversation[]): number {
  return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
}

// The conversation the coach is looking at on a client's page goes to the top of the floating panel's list, labelled "Viewing"; on any other page nothing is pinned. It is only pinned,
// never opened: one tap opens the thread. Returns the list and which row (if any) is the pinned one.
export function withPinnedClient(conversations: InboxConversation[], viewingClientId: string | null): { list: InboxConversation[]; pinnedId: string | null } {
  if (!viewingClientId) return { list: conversations, pinnedId: null };
  const mine = conversations.find((c) => c.otherId === viewingClientId);
  if (!mine) return { list: conversations, pinnedId: null };
  return { list: [mine, ...conversations.filter((c) => c.otherId !== viewingClientId)], pinnedId: viewingClientId };
}

// Which conversation the two-pane page opens: the one named in ?with= when it is a real conversation of this coach, else none (the pane asks the coach to pick one).
export function selectedConversation(conversations: InboxConversation[], withId: string | null | undefined): InboxConversation | null {
  if (!withId) return null;
  return conversations.find((c) => c.otherId === withId) ?? null;
}

// The floating panel's quick view: the pressing items first. Unread conversations, then clients waiting on a reply (their message was read but not answered), then everyone else by recent
// activity. A section that is empty is simply absent.
export interface PanelSections {
  unread: InboxConversation[];
  waiting: InboxConversation[];
  others: InboxConversation[];
}

export function panelSections(conversations: InboxConversation[]): PanelSections {
  const ordered = unreadFirst(conversations);
  return {
    unread: ordered.filter((c) => c.unreadCount > 0),
    waiting: ordered.filter((c) => c.unreadCount === 0 && c.lastFromOther),
    others: ordered.filter((c) => c.unreadCount === 0 && !c.lastFromOther),
  };
}

// The bell's urgent notices a coach should see in the quick view: requests and changes that need an answer.
export const URGENT_NOTICE_TYPES = ["schedule_request", "late_change", "booking_request", "recurring_booking_conflict"] as const;

// The client whose page the coach is on (/groups/{id}/athletes/{clientId}, any tab or sub-page), or null on every other page. The floating panel pins this client; it never opens them.
export function clientIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/groups\/[^/]+\/athletes\/([^/?#]+)/.exec(pathname ?? "");
  return m ? m[1] : null;
}
