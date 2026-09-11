"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";

const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 100 * 1024 * 1024;

export interface UploadedVideo {
  id: string;
  videoPath: string;
  athleteId: string;
  createdAt: string;
}

// Same MIME whitelist + 100MB cap as components/coach/exercise-media-picker.tsx
// — the stricter, validated pattern, not the feed composer's unvalidated one.
export function ExerciseVideoUpload({
  sessionId,
  sessionExerciseId,
  groupId,
  athleteId,
  onUploaded,
}: {
  sessionId: string;
  sessionExerciseId: string;
  groupId: string;
  athleteId: string;
  onUploaded: (video: UploadedVideo) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

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

    const ext = file.name.split(".").pop() || "mp4";
    const path = `${groupId}/${sessionExerciseId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("athlete-exercise-videos")
      .upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data: row, error: dbError } = await supabase
      .from("session_exercise_videos")
      .insert({ session_exercise_id: sessionExerciseId, athlete_id: athleteId, group_id: groupId, video_path: path })
      .select("id, video_path, athlete_id, created_at")
      .single();

    setUploading(false);

    if (dbError || !row) {
      setError("Couldn't save the video — try again.");
      return;
    }

    onUploaded({ id: row.id, videoPath: row.video_path, athleteId: row.athlete_id, createdAt: row.created_at });

    // Trigger already wrote the in-app notification row for every coach —
    // it can't also fire the push, so this fires it right after the
    // upload it already knows succeeded (same split as comments).
    const { data: coachRows } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", groupId)
      .eq("role", "coach");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    for (const coach of coachRows ?? []) {
      if (coach.profile_id !== user?.id) {
        notifyPush(coach.profile_id, "New video", "A client uploaded a form-check video", `/sessions/${sessionId}`);
      }
    }
  }

  return (
    <div className="mt-2">
      <label className="inline-flex items-center gap-1.5 font-body text-xs text-rust cursor-pointer">
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={handleFileChange}
          disabled={uploading}
          className="hidden"
        />
        🎥 {uploading ? "Uploading…" : "Attach form-check video"}
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
