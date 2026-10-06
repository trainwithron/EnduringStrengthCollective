import type { GroupKind } from "@/lib/coach-groups";

// The coach's one inbox: a conversation per client across every group the coach coaches in the organization, not one group's list.
// Messages are stored per group, so a conversation opens in the group of its newest message (so a reply lands where the client
// wrote), or in the client's one-on-one group when nothing has been said yet. Unread counts add up across all of the client's groups.

export interface InboxPerson {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  groupId: string;
  groupKind: GroupKind;
}

export interface InboxMessage {
  group_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface InboxConversation {
  otherId: string;
  groupId: string;
  fullName: string;
  avatarUrl: string | null;
  lastBody: string | null;
  lastAt: string | null;
  unreadCount: number;
}

const KIND_RANK: Record<GroupKind, number> = { one_on_one: 0, team: 1, social: 2 };

export function buildCoachInbox(people: InboxPerson[], messages: InboxMessage[], viewerId: string): InboxConversation[] {
  const byId = new Map<string, InboxConversation & { _rank: number; _groups: Set<string> }>();
  for (const p of people) {
    const existing = byId.get(p.id);
    if (!existing) {
      byId.set(p.id, {
        otherId: p.id,
        groupId: p.groupId,
        fullName: p.fullName,
        avatarUrl: p.avatarUrl,
        lastBody: null,
        lastAt: null,
        unreadCount: 0,
        _rank: KIND_RANK[p.groupKind],
        _groups: new Set([p.groupId]),
      });
    } else {
      existing._groups.add(p.groupId);
      if (KIND_RANK[p.groupKind] < existing._rank) {
        existing._rank = KIND_RANK[p.groupKind];
        existing.groupId = p.groupId;
      }
    }
  }
  for (const m of messages) {
    const otherId = m.sender_id === viewerId ? m.recipient_id : m.sender_id;
    const row = byId.get(otherId);
    // Only messages in a group this client is actually in count; anything else is not part of this inbox.
    if (!row || !row._groups.has(m.group_id)) continue;
    if (!row.lastAt || m.created_at > row.lastAt) {
      row.lastAt = m.created_at;
      row.lastBody = m.body;
      row.groupId = m.group_id;
    }
    if (m.recipient_id === viewerId && !m.read_at) row.unreadCount++;
  }
  return Array.from(byId.values())
    .map(({ _rank, _groups, ...c }) => c)
    .sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
      if (a.lastAt) return -1;
      if (b.lastAt) return 1;
      return a.fullName.localeCompare(b.fullName);
    });
}
