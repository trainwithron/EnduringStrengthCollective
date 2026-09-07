"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Camera, X } from "lucide-react";
import type { FeedChannel } from "@/lib/types";

const CHANNEL_LABELS: Record<FeedChannel, string> = {
  announcements: "Announcements",
  form_checks: "Form Checks",
  pr_board: "PR Board",
  general: "General",
};

export function NewPostComposer({
  groupId,
  raised,
  defaultChannel = "general",
  isCoach = false,
}: {
  groupId: string;
  raised?: boolean;
  defaultChannel?: FeedChannel;
  isCoach?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [channel, setChannel] = useState<FeedChannel>(
    defaultChannel === "announcements" && !isCoach ? "general" : defaultChannel
  );
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const postableChannels: FeedChannel[] = isCoach
    ? ["announcements", "form_checks", "pr_board", "general"]
    : ["form_checks", "pr_board", "general"];

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
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed ${
          raised ? "bottom-24" : "bottom-6"
        } right-5 w-14 h-14 rounded-full bg-rust text-graphite flex items-center justify-center shadow-lg active:bg-rust/80 transition-colors font-display text-2xl`}
        aria-label="New post"
      >
        +
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-graphite/95 z-40 flex items-end">
      <div className="w-full bg-surface p-5 pb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display uppercase text-lg">New post</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="w-9 h-9 flex items-center justify-center text-steel">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="flex flex-col gap-1 mb-3">
          <span className="font-body text-[11px] text-steel uppercase tracking-wide">
            Channel
          </span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as FeedChannel)}
            className="h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
          >
            {postableChannels.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share a form check, a win, or a shoutout"
          rows={3}
          className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body focus:outline-none focus:border-rust resize-none"
        />

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-2 h-11 px-3 border border-steel/30 text-steel text-sm active:border-rust active:text-rust transition-colors"
          >
            <Camera className="w-4 h-4" />
            {file ? file.name.slice(0, 20) : "Add photo or video"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <button
          type="button"
          onClick={handlePost}
          disabled={submitting}
          className="w-full h-12 bg-rust text-graphite font-body text-sm font-medium mt-4 disabled:opacity-40"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
