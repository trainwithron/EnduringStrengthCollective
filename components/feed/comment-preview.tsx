"use client";

import { MessageCircle } from "lucide-react";

export function CommentPreview({
  commentCount,
  open,
  onToggle,
}: {
  commentCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 h-11 px-3 border transition-colors ${
        open
          ? "border-rust text-rust-ink bg-rust/10"
          : "border-steel/30 text-steel active:border-rust active:text-rust-ink"
      }`}
    >
      <MessageCircle className="w-4 h-4" />
      <span className="font-body text-sm">
        {commentCount === 0 ? "Comment" : `${commentCount} ${commentCount === 1 ? "Comment" : "Comments"}`}
      </span>
    </button>
  );
}
