"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

export function ShareWorkoutButton({
  postId,
  title,
  size = "small",
  path,
}: {
  postId?: string;
  title: string;
  size?: "small" | "large";
  // Override for a non-workout share surface (e.g. a milestone
  // celebration card) that doesn't have a postId at all — defaults to
  // the original `/share/{postId}` behavior when omitted.
  path?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = `${window.location.origin}${path ?? `/share/${postId}`}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled the share sheet — not an error.
      }
      return;
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (size === "large") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="w-full h-12 flex items-center justify-center gap-2 bg-rust text-graphite font-display uppercase text-sm font-bold active:bg-rust/80 transition-colors"
      >
        <Share2 className="w-4 h-4" />
        {copied ? "Link copied!" : "Share"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="flex items-center gap-1.5 font-body text-xs text-rust active:opacity-70 transition-opacity"
    >
      <Share2 className="w-3.5 h-3.5" />
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
