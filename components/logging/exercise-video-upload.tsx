"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { demoContentType, demoExtension, FORM_CHECK_LIMITS, uploadDemo } from "@/lib/exercise-demo-upload";
import { prepareDemo } from "@/lib/demo-convert";
import { MINOR_VIDEO_REFUSED } from "@/lib/video-reports";

export interface UploadedVideo {
  id: string;
  videoPath: string;
  athleteId: string;
  createdAt: string;
}

// A client's form-check video on one exercise (Ron, Nov 20, V1). It uses the exercise-demo uploader: the phone makes it 1080p first, it uploads in pieces with a progress bar and
// picks up where it left off after a dropped signal, and a minute is the limit. accept="video/*" with no `capture`: the phone offers its camera AND its gallery (the old exact type
// list made some phones offer only the gallery).
export function ExerciseVideoUpload({
  sessionId,
  sessionExerciseId,
  groupId,
  athleteId,
  onUploaded,
  compact = false,
}: {
  sessionId: string;
  sessionExerciseId: string;
  groupId: string;
  athleteId: string;
  onUploaded: (video: UploadedVideo) => void;
  // The Form check button beside "+ Add a set" (Look Refresh, client step): just the button (and its progress and any error); the filming tips go under the row (FormCheckTips).
  compact?: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<"convert" | "upload">("upload");
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;

    setError(null);
    setStage("convert");
    setProgress(0);
    const prepared = await prepareDemo(picked, { mute: false, onProgress: setProgress, limits: FORM_CHECK_LIMITS });
    if (!prepared.ok) {
      setProgress(null);
      return setError(prepared.error);
    }
    const file = prepared.file;
    const contentType = demoContentType(file)!;

    setStage("upload");
    setProgress(0);
    const supabase = createBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setProgress(null);
      return setError("You're signed out. Sign in again, then try.");
    }
    const up = await uploadDemo({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      accessToken: token,
      path: `${groupId}/${sessionExerciseId}/${crypto.randomUUID()}.${demoExtension(contentType)}`,
      file,
      contentType,
      onProgress: setProgress,
      bucket: "athlete-exercise-videos",
    });
    if (!up.ok) {
      setProgress(null);
      return setError(up.error);
    }

    const { data: row, error: dbError } = await supabase
      .from("session_exercise_videos")
      .insert({ session_exercise_id: sessionExerciseId, athlete_id: athleteId, group_id: groupId, video_path: up.path })
      .select("id, video_path, athlete_id, created_at")
      .single();

    setProgress(null);

    if (dbError || !row) {
      await supabase.storage.from("athlete-exercise-videos").remove([up.path]);
      // the database's age rules (a client's own: minor_may_write; a coach's upload for a client: minor_subject_ok, step 211)
      setError(dbError?.code === "42501" ? (athleteId === (await supabase.auth.getUser()).data.user?.id ? "Videos need a parent's consent on file first. Ask your coach." : MINOR_VIDEO_REFUSED) : "Couldn't save the video. Try again.");
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

  const uploading = progress != null;
  if (compact) {
    return (
      <div className="shrink-0 flex flex-col items-end">
        {uploading ? (
          <span role="status" aria-live="polite" className="h-11 px-3.5 rounded-row tint-checkin inline-flex items-center font-body text-[13px] font-medium text-checkin tabular-nums">
            {stage === "convert" ? "Getting it ready" : "Uploading"} {Math.round((progress ?? 0) * 100)}%
          </span>
        ) : (
          <label className="h-11 px-3.5 rounded-row tint-checkin inline-flex items-center gap-1.5 font-body text-[13px] font-medium text-checkin cursor-pointer" aria-label="Record or attach a form-check video">
            <input type="file" accept="video/*" onChange={(e) => void handleFileChange(e)} className="hidden" />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="2" />
              <path d="M16 10l5-3v10l-5-3" />
            </svg>
            Form check
          </label>
        )}
        {error && (
          <p className="font-body text-xs text-rust mt-1 text-right" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {uploading ? (
        <div role="status" aria-live="polite">
          <div className="h-1.5 w-full max-w-xs bg-steel/20 overflow-hidden">
            <div className="h-full bg-rust transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
          <p className="font-body text-xs text-steel mt-1">
            {stage === "convert" ? "Getting it ready" : "Uploading"}… {Math.round((progress ?? 0) * 100)}%. Keep this page open.
          </p>
        </div>
      ) : (
        <>
          <label className="inline-flex items-center gap-1.5 min-h-11 font-body text-xs text-rust cursor-pointer">
            <input type="file" accept="video/*" onChange={(e) => void handleFileChange(e)} className="hidden" />
            🎥 Record or attach a form-check video
          </label>
          {/* Ron, Nov 20 (V2): a filming tip and who can see it. */}
          <p className="font-body text-[11px] text-steel leading-snug">Film from the side with your whole body in the frame. Up to a minute.</p>
          <p className="font-body text-[11px] text-steel leading-snug">Only you and your coach can see this.</p>
        </>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Under the "+ Add a set" / Form check row: how to film it and who sees it (Ron, Nov 20, V2).
export function FormCheckTips() {
  return (
    <div className="mt-1.5">
      <p className="font-body text-[11px] text-steel leading-snug">Film from the side with your whole body in the frame. Up to a minute.</p>
      <p className="font-body text-[11px] text-steel leading-snug">Only you and your coach can see this.</p>
    </div>
  );
}
