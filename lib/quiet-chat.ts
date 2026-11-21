import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readByIds } from "@/lib/read-by-ids";

// Clients who have gone quiet IN CHAT (Ron, Nov 20: R3): the client hasn't sent the coach a message or a reply in QUIET_CHAT_DAYS or more, while the coach has messaged them since.
// Distinct from the training flag (quiet_client: no workouts). Only for clients who use chat: one who has not written to the coach at all in the last LOOK_BACK_DAYS is not shown
// (they do not use chat, or have been away far longer, which the training flag and "Probably inactive" already cover).

export const QUIET_CHAT_DAYS = 14;
export const LOOK_BACK_DAYS = 120;
const DAY = 86_400_000;

export interface ChatMessage {
  sender_id: string;
  recipient_id: string;
  group_id: string;
  created_at: string;
}

export interface QuietInChat {
  athleteId: string;
  groupId: string;
  /** whole days since the client last wrote to the coach */
  days: number;
  lastFromClient: string;
}

/** The clients quiet in chat, the longest quiet first. Only clients in `clients` (the coach's current clients) count; the coach's own messages to themselves never do. */
export function quietInChat(messages: ChatMessage[], coachId: string, clients: Set<string>, now: Date): QuietInChat[] {
  const byClient = new Map<string, { lastFromClient: number; lastFromCoach: number; groupId: string }>();
  for (const m of messages) {
    const fromCoach = m.sender_id === coachId;
    const other = fromCoach ? m.recipient_id : m.sender_id;
    if (other === coachId || (!fromCoach && m.recipient_id !== coachId) || !clients.has(other)) continue;
    const t = new Date(m.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = byClient.get(other) ?? { lastFromClient: -Infinity, lastFromCoach: -Infinity, groupId: m.group_id };
    if (fromCoach) cur.lastFromCoach = Math.max(cur.lastFromCoach, t);
    else if (t > cur.lastFromClient) {
      cur.lastFromClient = t;
      // the conversation they last wrote in is the one to answer in
      cur.groupId = m.group_id;
    }
    byClient.set(other, cur);
  }
  const out: QuietInChat[] = [];
  for (const [athleteId, v] of byClient) {
    if (!Number.isFinite(v.lastFromClient)) continue; // never wrote: does not use chat
    const days = Math.floor((now.getTime() - v.lastFromClient) / DAY);
    if (days < QUIET_CHAT_DAYS) continue;
    if (!(v.lastFromCoach > v.lastFromClient)) continue; // the coach has not written since: nothing is waiting on the client
    out.push({ athleteId, groupId: v.groupId, days, lastFromClient: new Date(v.lastFromClient).toISOString() });
  }
  return out.sort((a, b) => b.days - a.days || a.athleteId.localeCompare(b.athleteId));
}

/** "hasn't replied in chat for 18 days." (follows the client's name). */
export function quietChatSentence(days: number): string {
  return `hasn't replied in chat for ${days} days. You've messaged since.`;
}

export interface QuietChatLoad {
  quiet: QuietInChat[];
  names: Map<string, string>;
  failed: boolean;
}

/**
 * The coach's conversations with their current clients over the last LOOK_BACK_DAYS (both directions), and who is quiet in them. Read once per page (Needs you and its panel share it).
 * A read that fails is a failure, never "nobody is quiet".
 */
export const loadQuietInChat = cache(async (supabase: SupabaseClient, coachId: string, groupIdsKey: string, nowIso: string): Promise<QuietChatLoad> => {
  const groupIds = groupIdsKey ? groupIdsKey.split(",") : [];
  const empty: QuietChatLoad = { quiet: [], names: new Map(), failed: false };
  if (groupIds.length === 0) return empty;
  const now = new Date(nowIso);
  const since = new Date(now.getTime() - LOOK_BACK_DAYS * DAY).toISOString();
  try {
    const [roster, sent, received] = await Promise.all([
      readByIds(groupIds, (g) => (from, to) => supabase.from("group_memberships").select("group_id, profile_id").in("group_id", g).eq("role", "athlete").order("group_id").order("profile_id").range(from, to)),
      readByIds(groupIds, (g) => (from, to) => supabase.from("direct_messages").select("sender_id, recipient_id, group_id, created_at").in("group_id", g).eq("sender_id", coachId).gte("created_at", since).order("created_at").order("id").range(from, to)),
      readByIds(groupIds, (g) => (from, to) => supabase.from("direct_messages").select("sender_id, recipient_id, group_id, created_at").in("group_id", g).eq("recipient_id", coachId).gte("created_at", since).order("created_at").order("id").range(from, to)),
    ]);
    // a read cut short could leave out a client's newest message and flag them wrongly: count it as failed
    if ([roster, sent, received].some((r) => r.failed || r.truncated)) return { ...empty, failed: true };
    const clients = new Set((roster.rows as { profile_id: string }[]).map((r) => r.profile_id).filter((id) => id !== coachId));
    const quiet = quietInChat([...(sent.rows as ChatMessage[]), ...(received.rows as ChatMessage[])], coachId, clients, now);
    const names = new Map<string, string>();
    if (quiet.length > 0) {
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", quiet.slice(0, 200).map((q) => q.athleteId));
      if (!error) for (const p of (data ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name?.trim() || "A client");
    }
    return { quiet, names, failed: false };
  } catch (e) {
    console.error("[quiet-chat] failed:", e instanceof Error ? e.message : e);
    return { ...empty, failed: true };
  }
});
