import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface MentionCandidate {
  id: string;
  fullName: string;
}

// Shared by every composer that supports "@Name" tagging (post
// composers, the comment box) — fetches this group's roster once, then
// tracks whatever's typed after the last "@" (as long as it has no space
// yet) as the active mention search. A single-line input or a textarea
// both work the same way here since this only does string ops on the
// current value, never caret/selection math.
export function useMentionAutocomplete(groupId: string | null) {
  const [members, setMembers] = useState<MentionCandidate[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    const supabase = createBrowserClient();
    supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("group_id", groupId)
      .then(({ data }) => {
        setMembers(
          (data ?? [])
            .map((r: any) => ({ id: r.profile_id, fullName: r.profiles?.full_name ?? "" }))
            .filter((m) => m.fullName)
        );
      });
  }, [groupId]);

  function detectMentionQuery(value: string): string | null {
    const at = value.lastIndexOf("@");
    if (at === -1) return null;
    const afterAt = value.slice(at + 1);
    if (afterAt.includes(" ") || afterAt.includes("\n")) return null;
    return afterAt;
  }

  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.fullName.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

  function applyMention(currentValue: string, member: MentionCandidate): string {
    const at = currentValue.lastIndexOf("@");
    setMentionQuery(null);
    return `${currentValue.slice(0, at)}@${member.fullName} `;
  }

  return { mentionQuery, setMentionQuery, mentionMatches, detectMentionQuery, applyMention };
}
