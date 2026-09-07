"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 100 * 1024 * 1024;

function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Video is attached to the shared exercise_library row (keyed by name),
// same upsert-by-name mechanism used to grow the library elsewhere — so
// attaching a video from one card surfaces it on every card using that name.
export function ExerciseMediaPicker({
  exerciseName,
  videoPath,
  youtubeUrl,
  onChange,
}: {
  exerciseName: string;
  videoPath: string | null;
  youtubeUrl: string | null;
  onChange: (patch: { videoPath?: string | null; youtubeUrl?: string | null }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [urlDraft, setUrlDraft] = useState(youtubeUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [videoSignedUrl, setVideoSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (videoPath) {
      const supabase = createBrowserClient();
      supabase.storage
        .from("exercise-media")
        .createSignedUrl(videoPath, 3600)
        .then(({ data }) => {
          if (!cancelled) setVideoSignedUrl(data?.signedUrl ?? null);
        });
    } else {
      setVideoSignedUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const name = exerciseName.trim();
    if (!file || !name) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use an MP4, MOV, or WebM video.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Video must be under 100MB.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setUploading(false);
      return;
    }

    const ext = file.name.split(".").pop() || "mp4";
    const path = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("exercise-media")
      .upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase
      .from("exercise_library")
      .upsert(
        { created_by: userData.user.id, name, video_path: path },
        { onConflict: "created_by,name" }
      );

    if (dbError) {
      setError(dbError.message);
      setUploading(false);
      return;
    }

    onChange({ videoPath: path });
    setUploading(false);
  }

  async function handleSaveYoutubeUrl() {
    const trimmed = urlDraft.trim();
    if (trimmed && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(trimmed)) {
      setError("That doesn't look like a YouTube URL.");
      return;
    }
    const name = exerciseName.trim();
    if (!name) return;

    setError(null);
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error: dbError } = await supabase
      .from("exercise_library")
      .upsert(
        { created_by: userData.user.id, name, youtube_url: trimmed || null },
        { onConflict: "created_by,name" }
      );

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onChange({ youtubeUrl: trimmed || null });
  }

  async function handleRemoveVideo() {
    const name = exerciseName.trim();
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user || !name) return;

    if (videoPath) {
      await supabase.storage.from("exercise-media").remove([videoPath]);
    }
    const { error: dbError } = await supabase
      .from("exercise_library")
      .upsert(
        { created_by: userData.user.id, name, video_path: null },
        { onConflict: "created_by,name" }
      );

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onChange({ videoPath: null });
  }

  const youtubeId = youtubeUrl ? extractYoutubeId(youtubeUrl) : null;

  return (
    <div className="space-y-2">
      {videoPath && videoSignedUrl && (
        <div className="flex items-center gap-2">
          <video
            src={videoSignedUrl}
            controls
            className="w-24 h-16 bg-graphite object-cover"
          />
          <button
            type="button"
            onClick={handleRemoveVideo}
            className="font-body text-xs text-steel active:text-rust transition-colors"
          >
            Remove
          </button>
        </div>
      )}

      {youtubeId && (
        <a
          href={youtubeUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 w-fit"
        >
          <img
            src={`https://img.youtube.com/vi/${youtubeId}/default.jpg`}
            alt="YouTube thumbnail"
            className="w-24 h-16 object-cover"
          />
          <span className="font-body text-xs text-rust">Open on YouTube</span>
        </a>
      )}

      {!videoPath && (
        <div>
          <label className="font-body text-xs text-steel uppercase tracking-wide block mb-1">
            Upload video
          </label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            onChange={handleFileChange}
            disabled={uploading}
            className="font-body text-xs text-steel w-full"
          />
          {uploading && <p className="font-body text-xs text-steel mt-1">Uploading…</p>}
        </div>
      )}

      {!youtubeUrl && (
        <div className="flex gap-2">
          <input
            type="text"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="YouTube link"
            className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
          />
          <button
            type="button"
            onClick={handleSaveYoutubeUrl}
            className="font-body text-xs text-rust shrink-0"
          >
            Save
          </button>
        </div>
      )}

      {youtubeUrl && (
        <button
          type="button"
          onClick={() => {
            setUrlDraft("");
            onChange({ youtubeUrl: null });
          }}
          className="font-body text-xs text-steel active:text-rust transition-colors"
        >
          Remove YouTube link
        </button>
      )}

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
