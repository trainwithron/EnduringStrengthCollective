"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { X } from "lucide-react";

interface CommentRow {
  id: string;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  profiles: { full_name: string };
}

export function CommentThreadSheet({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    supabase
      .from("comments")
      .select("id, body, parent_comment_id, created_at, profiles ( full_name )")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as any) ?? []));

    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
        async (payload) => {
          const { data } = await supabase
            .from("comments")
            .select("id, body, parent_comment_id, created_at, profiles ( full_name )")
            .eq("id", payload.new.id)
            .single();
          if (data) setComments((prev) => [...prev, data as any]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId]);

  async function handleSend() {
    if (!body.trim()) return;
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

    await supabase.from("comments").insert({
      post_id: postId,
      group_id: post.group_id,
      author_id: user.id,
      parent_comment_id: replyTo,
      body: body.trim(),
    });

    setBody("");
    setReplyTo(null);
  }

  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const repliesTo = (parentId: string) =>
    comments.filter((c) => c.parent_comment_id === parentId);

  return (
    <div className="fixed inset-0 bg-graphite/95 z-40 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-steel/20">
        <h2 className="font-display uppercase text-lg">Comments</h2>
        <button onClick={onClose} aria-label="Close" className="w-9 h-9 flex items-center justify-center text-steel">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {topLevel.length === 0 && (
          <p className="font-body text-sm text-steel">Be the first to comment.</p>
        )}
        {topLevel.map((c) => (
          <div key={c.id}>
            <CommentLine comment={c} onReply={() => setReplyTo(c.id)} />
            {repliesTo(c.id).length > 0 && (
              <div className="ml-6 mt-2 space-y-2 border-l border-steel/20 pl-3">
                {repliesTo(c.id).map((r) => (
                  <CommentLine key={r.id} comment={r} onReply={() => setReplyTo(c.id)} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-steel/20">
        {replyTo && (
          <div className="flex items-center justify-between mb-2">
            <p className="font-body text-xs text-steel">Replying to thread</p>
            <button onClick={() => setReplyTo(null)} className="font-body text-xs text-rust">
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment"
            className="flex-1 h-11 bg-surface border border-steel/30 text-chalk px-3 font-body focus:outline-none focus:border-rust"
          />
          <button
            type="button"
            onClick={handleSend}
            className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentLine({
  comment,
  onReply,
}: {
  comment: CommentRow;
  onReply: () => void;
}) {
  return (
    <div>
      <p className="font-body text-sm">
        <span className="font-medium">{comment.profiles.full_name}</span>{" "}
        <span className="text-chalk">{comment.body}</span>
      </p>
      <button onClick={onReply} className="font-body text-xs text-steel mt-0.5">
        Reply
      </button>
    </div>
  );
}
