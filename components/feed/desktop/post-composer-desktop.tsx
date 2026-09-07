"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import type { FeedChannel } from "@/lib/types";

// Same posting logic as the mobile FAB+sheet composer
// (components/feed/new-post-composer.tsx) — just an always-visible inline
// box instead of a floating trigger + full-screen sheet, which reads as a
// distinctly mobile pattern on a wide desktop page.
export function PostComposerDesktop({
  groupId,
  defaultChannel = "general",
  isCoach = false,
}: {
  groupId: string;
  defaultChannel?: FeedChannel;
  isCoach?: boolean;
}) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // A post always goes into whichever channel tab is currently open — no
  // separate per-post picker. Announcements stays coach-only to post in;
  // a non-coach viewing that tab just gets no composer (RLS is the real
  // enforcement, this just avoids offering a control that would only fail).
  const canPostHere = defaultChannel !== "announcements" || isCoach;
  const channel = defaultChannel;

  async function handlePost() {
    if (!body.trim() && !file) return;
    setSubmitting(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;

    if (file) {
      const path = `${groupId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("post-media")
        .upload(path, file);

      if (!uploadError) {
        const { data: signed } = await supabase.storage
          .from("post-media")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        mediaUrl = signed?.signedUrl ?? null;
        mediaType = file.type.startsWith("video") ? "video" : "image";
      }
    }

    await supabase.from("posts").insert({
      group_id: groupId,
      author_id: user.id,
      post_type: "user_post",
      channel,
      body: body.trim() || null,
      media_url: mediaUrl,
      media_type: mediaType,
    });

    setBody("");
    setFile(null);
    setSubmitting(false);
    router.refresh();
  }

  if (!canPostHere) return null;

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-6">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share a form check, a win, or a shoutout"
        rows={3}
        className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
      />

      <div className="flex items-center justify-between mt-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 h-9 px-3 border border-steel/30 text-steel text-xs active:border-rust active:text-rust transition-colors"
        >
          <Camera className="w-4 h-4" />
          {file ? file.name.slice(0, 24) : "Add photo or video"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={handlePost}
          disabled={submitting}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
