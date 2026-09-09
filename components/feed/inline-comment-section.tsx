"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

interface CommentRow {
  id: string;
  body: string;
  author_id: string;
  parent_comment_id: string | null;
  created_at: string;
  profiles: { full_name: string };
}

// Renders inline, directly under the post it belongs to — Facebook-style,
// not a full-screen takeover — so which post you're commenting on is
// never ambiguous: it's the one right above the box.
interface MentionCandidate {
  id: string;
  fullName: string;
}

export function InlineCommentSection({
  postId,
  viewerId,
  isCoach,
}: {
  postId: string;
  viewerId: string | null;
  isCoach: boolean;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [members, setMembers] = useState<MentionCandidate[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    supabase
      .from("comments")
      .select("id, body, author_id, parent_comment_id, created_at, profiles ( full_name )")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as any) ?? []));

    // Mention candidates — every member of this post's group, fetched
    // once so typing "@" doesn't need a round trip per keystroke.
    supabase
      .from("posts")
      .select("group_id")
      .eq("id", postId)
      .single()
      .then(async ({ data: post }) => {
        if (!post) return;
        const { data: rows } = await supabase
          .from("group_memberships")
          .select("profile_id, profiles ( full_name )")
          .eq("group_id", post.group_id);
        setMembers(
          (rows ?? [])
            .map((r: any) => ({ id: r.profile_id, fullName: r.profiles?.full_name ?? "" }))
            .filter((m) => m.fullName)
        );
      });

    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
        async (payload) => {
          const { data } = await supabase
            .from("comments")
            .select("id, body, author_id, parent_comment_id, created_at, profiles ( full_name )")
            .eq("id", payload.new.id)
            .single();
          if (data) setComments((prev) => [...prev, data as any]);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
        (payload) => {
          setComments((prev) => prev.filter((c) => c.id !== payload.old.id));
        }
      )
      .subscribe();

    // Opening the section pops the keyboard on mobile — same intent as a
    // dedicated compose screen, without leaving the feed to get there.
    inputRef.current?.focus();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId]);

  // Tracks whatever's typed after the last "@" (as long as it has no
  // space yet) as the active mention search — a single-line input, so
  // "the last @ with no space after it" is an unambiguous stand-in for
  // "the word currently being typed."
  function handleBodyChange(value: string) {
    setBody(value);
    const at = value.lastIndexOf("@");
    if (at === -1) {
      setMentionQuery(null);
      return;
    }
    const afterAt = value.slice(at + 1);
    if (afterAt.includes(" ")) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(afterAt);
  }

  const mentionMatches =
    mentionQuery !== null
      ? members
          .filter((m) => m.fullName.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6)
      : [];

  function applyMention(member: MentionCandidate) {
    const at = body.lastIndexOf("@");
    const newBody = `${body.slice(0, at)}@${member.fullName} `;
    setBody(newBody);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    const trimmedBody = body.trim();
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // group_id is required by the schema; look it up from the post.
      const { data: post } = await supabase
        .from("posts")
        .select("group_id")
        .eq("id", postId)
        .single();

      if (!post) return;

      const { error: insertError } = await supabase.from("comments").insert({
        post_id: postId,
        group_id: post.group_id,
        author_id: user.id,
        parent_comment_id: replyTo,
        body: trimmedBody,
      });

      if (insertError) {
        setError("Couldn't post — check your connection and try again.");
        return;
      }

      setBody("");
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(commentId: string) {
    if (deletingId) return;
    setDeletingId(commentId);
    setError(null);
    const supabase = createBrowserClient();
    const { error: deleteError } = await supabase.from("comments").delete().eq("id", commentId);
    setDeletingId(null);
    if (deleteError) {
      setError("Couldn't delete — check your connection and try again.");
      return;
    }
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const repliesTo = (parentId: string) =>
    comments.filter((c) => c.parent_comment_id === parentId);

  const canDelete = (comment: CommentRow) => comment.author_id === viewerId || isCoach;
  const replyTarget = replyTo ? comments.find((c) => c.id === replyTo) : null;

  return (
    <div className="mt-3 pt-3 border-t border-steel/15 space-y-3">
      {topLevel.length === 0 && (
        <p className="font-body text-xs text-steel">Be the first to comment.</p>
      )}
      {topLevel.map((c) => (
        <div key={c.id}>
          <CommentLine
            comment={c}
            onReply={() => setReplyTo(c.id)}
            onDelete={canDelete(c) ? () => handleDelete(c.id) : undefined}
            deleting={deletingId === c.id}
          />
          {repliesTo(c.id).length > 0 && (
            <div className="ml-6 mt-2 space-y-2 border-l border-steel/20 pl-3">
              {repliesTo(c.id).map((r) => (
                <CommentLine
                  key={r.id}
                  comment={r}
                  onReply={() => setReplyTo(c.id)}
                  onDelete={canDelete(r) ? () => handleDelete(r.id) : undefined}
                  deleting={deletingId === r.id}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {replyTarget && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-steel">
            Replying to {replyTarget.profiles.full_name}
          </p>
          <button onClick={() => setReplyTo(null)} className="font-body text-xs text-rust">
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="border border-rust/40 bg-surface max-h-40 overflow-y-auto">
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => applyMention(m)}
              className="w-full text-left px-3 py-2 font-body text-sm text-chalk hover:bg-graphite/50"
            >
              @{m.fullName}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && mentionQuery === null) handleSend();
          }}
          placeholder={replyTarget ? `Reply to ${replyTarget.profiles.full_name}` : "Add a comment"}
          disabled={sending}
          className="flex-1 h-10 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !body.trim()}
          className="h-10 px-3.5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// Light-touch highlighting — matches "@First Last" / "@First" without
// needing this render path to know the actual member list. Good enough
// for visual emphasis; the real notification (who actually gets pinged)
// is resolved server-side against real member names, not this regex.
const MENTION_PATTERN = /@[A-Z][a-zA-Z'-]*(?:\s[A-Z][a-zA-Z'-]*)?/g;

function renderWithMentions(body: string) {
  const parts = body.split(MENTION_PATTERN);
  const matches = body.match(MENTION_PATTERN) ?? [];
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    out.push(part);
    if (matches[i]) {
      out.push(
        <span key={i} className="text-rust font-medium">
          {matches[i]}
        </span>
      );
    }
  });
  return out;
}

function CommentLine({
  comment,
  onReply,
  onDelete,
  deleting,
}: {
  comment: CommentRow;
  onReply: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  return (
    <div>
      <p className="font-body text-sm">
        <span className="font-medium">{comment.profiles.full_name}</span>{" "}
        <span className="text-chalk">{renderWithMentions(comment.body)}</span>
      </p>
      <div className="flex items-center gap-3 mt-0.5">
        <button onClick={onReply} className="font-body text-xs text-steel">
          Reply
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="font-body text-xs text-steel flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
