"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import type { FeedChannel } from "@/lib/types";
import { useMentionAutocomplete } from "@/lib/use-mention-autocomplete";
import { notifyPush } from "@/lib/push-notify";

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
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const {
    mentionQuery,
    setMentionQuery,
    mentionMatches,
    detectMentionQuery,
    applyMention,
    getConfirmedMentionIds,
    resetMentions,
  } = useMentionAutocomplete(groupId);

  // A post always goes into whichever channel tab is currently open — no
  // separate per-post picker. Announcements stays coach-only to post in;
  // a non-coach viewing that tab just gets no composer (RLS is the real
  // enforcement, this just avoids offering a control that would only fail).
  const canPostHere = defaultChannel !== "announcements" || isCoach;
  const channel = defaultChannel;

  async function handlePost() {
    if (!body.trim() && !file) return;
    setSubmitting(true);
    setError(null);
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

      if (uploadError) {
        setError("Couldn't upload that file — try again.");
        setSubmitting(false);
        return;
      }

      const { data: signed } = await supabase.storage
        .from("post-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      mediaUrl = signed?.signedUrl ?? null;
      mediaType = file.type.startsWith("video") ? "video" : "image";
    }

    const trimmedBody = body.trim() || null;
    const mentionedIds = trimmedBody ? getConfirmedMentionIds(trimmedBody) : [];
    const { error: insertError } = await supabase.from("posts").insert({
      group_id: groupId,
      author_id: user.id,
      post_type: "user_post",
      channel,
      body: trimmedBody,
      media_url: mediaUrl,
      media_type: mediaType,
      mentioned_profile_ids: mentionedIds,
    });

    setSubmitting(false);
    if (insertError) {
      setError("Couldn't post — try again.");
      return;
    }

    if (mentionedIds.length > 0) {
      // Mirrors notify_on_post_mention (migration 0093) — a trigger
      // can't also fire the push itself, so the composer does it right
      // after the insert it already knows succeeded.
      const { data: viewerProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const authorName = viewerProfile?.full_name ?? "Someone";
      const feedUrl = `/groups/${groupId}/feed`;
      for (const id of mentionedIds) {
        if (id !== user.id) notifyPush(id, "You were mentioned", `${authorName} mentioned you in a post`, feedUrl);
      }
    }

    setBody("");
    setFile(null);
    resetMentions();
    router.refresh();
  }

  if (!canPostHere) return null;

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-6">
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setMentionQuery(detectMentionQuery(e.target.value));
        }}
        placeholder="Share a form check, a win, or a shoutout — @ to tag someone"
        rows={3}
        className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
      />
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="border border-rust/40 bg-graphite max-h-40 overflow-y-auto -mt-px">
          {mentionMatches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setBody(applyMention(body, m))}
              className="w-full text-left px-3 py-2 font-body text-sm text-chalk hover:bg-surface/60"
            >
              @{m.fullName}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}

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
