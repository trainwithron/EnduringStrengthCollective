"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { CommentThreadSheet } from "./comment-thread-sheet";

export function CommentPreview({
  postId,
  commentCount,
}: {
  postId: string;
  commentCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-steel active:border-rust active:text-rust transition-colors"
      >
        <MessageCircle className="w-4 h-4" />
        <span className="font-body text-sm tabular-nums">{commentCount}</span>
      </button>

      {open && <CommentThreadSheet postId={postId} onClose={() => setOpen(false)} />}
    </>
  );
}
