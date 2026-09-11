"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";
import { ExerciseVideoUpload, type UploadedVideo } from "./exercise-video-upload";

interface VideoRow {
  id: string;
  videoPath: string;
  athleteId: string;
  createdAt: string;
  signedUrl: string | null;
}

interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

// Renders every video attached to this specific exercise instance, newest
// first, each with its own flat feedback thread — same realtime-subscribe/
// send pattern as components/feed/inline-comment-section.tsx, scoped to
// video_id instead of post_id.
export function ExerciseVideoThread({
  sessionId,
  sessionExerciseId,
  groupId,
  athleteId,
  viewerId,
  canUpload,
}: {
  sessionId: string;
  sessionExerciseId: string;
  groupId: string;
  athleteId: string;
  viewerId: string | null;
  canUpload: boolean;
}) {
  const [videos, setVideos] = useState<VideoRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("session_exercise_videos")
        .select("id, video_path, athlete_id, created_at")
        .eq("session_exercise_id", sessionExerciseId)
        .order("created_at", { ascending: false });

      const rows = await Promise.all(
        (data ?? []).map(async (v) => {
          const { data: signed } = await supabase.storage
            .from("athlete-exercise-videos")
            .createSignedUrl(v.video_path, 3600);
          return {
            id: v.id,
            videoPath: v.video_path,
            athleteId: v.athlete_id,
            createdAt: v.created_at,
            signedUrl: signed?.signedUrl ?? null,
          };
        })
      );
      if (!cancelled) setVideos(rows);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionExerciseId]);

  function handleUploaded(video: UploadedVideo) {
    setVideos((prev) => [
      { id: video.id, videoPath: video.videoPath, athleteId: video.athleteId, createdAt: video.createdAt, signedUrl: null },
      ...(prev ?? []),
    ]);
    // Sign the freshly-uploaded video's URL too, same as the initial load.
    const supabase = createBrowserClient();
    supabase.storage
      .from("athlete-exercise-videos")
      .createSignedUrl(video.videoPath, 3600)
      .then(({ data }) => {
        setVideos((prev) =>
          (prev ?? []).map((v) => (v.id === video.id ? { ...v, signedUrl: data?.signedUrl ?? null } : v))
        );
      });
  }

  return (
    <div className="mt-2">
      {videos && videos.length > 0 && (
        <div className="space-y-4 mb-2">
          {videos.map((v) => (
            <VideoWithComments key={v.id} video={v} groupId={groupId} viewerId={viewerId} />
          ))}
        </div>
      )}
      {canUpload && (
        <ExerciseVideoUpload
          sessionId={sessionId}
          sessionExerciseId={sessionExerciseId}
          groupId={groupId}
          athleteId={athleteId}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  );
}

function VideoWithComments({
  video,
  groupId,
  viewerId,
}: {
  video: VideoRow;
  groupId: string;
  viewerId: string | null;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    supabase
      .from("exercise_video_comments")
      .select("id, body, author_id, created_at, profiles ( full_name )")
      .eq("video_id", video.id)
      .order("created_at", { ascending: true })
      .then(({ data }) =>
        setComments(
          (data ?? []).map((c: any) => ({
            id: c.id,
            body: c.body,
            authorId: c.author_id,
            authorName: c.profiles?.full_name ?? "Someone",
            createdAt: c.created_at,
          }))
        )
      );

    const channel = supabase
      .channel(`exercise-video-comments:${video.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "exercise_video_comments", filter: `video_id=eq.${video.id}` },
        async (payload) => {
          const { data } = await supabase
            .from("exercise_video_comments")
            .select("id, body, author_id, created_at, profiles ( full_name )")
            .eq("id", payload.new.id)
            .single();
          if (data) {
            setComments((prev) => [
              ...prev,
              {
                id: data.id,
                body: data.body,
                authorId: data.author_id,
                authorName: (data as any).profiles?.full_name ?? "Someone",
                createdAt: data.created_at,
              },
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [video.id]);

  async function handleSend() {
    if (!body.trim() || sending || !viewerId) return;
    setSending(true);
    setError(null);
    const trimmedBody = body.trim();
    try {
      const supabase = createBrowserClient();
      const { error: insertError } = await supabase.from("exercise_video_comments").insert({
        video_id: video.id,
        group_id: groupId,
        author_id: viewerId,
        body: trimmedBody,
      });
      if (insertError) {
        setError("Couldn't send — check your connection and try again.");
        return;
      }
      // Trigger already wrote the in-app notification rows — this fires
      // the push, same split as every other comment-shaped feature here.
      if (video.athleteId !== viewerId) {
        notifyPush(video.athleteId, "New feedback", "Your coach left feedback on your video", location.pathname);
      }
      setBody("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-steel/20 p-2.5">
      {video.signedUrl ? (
        <video src={video.signedUrl} controls className="w-full max-w-[240px] bg-graphite" />
      ) : (
        <p className="font-body text-xs text-steel">Loading video…</p>
      )}

      <div className="mt-2 space-y-1.5">
        {comments.map((c) => (
          <p key={c.id} className="font-body text-xs">
            <span className="font-medium">{c.authorName}</span>{" "}
            <span className="text-chalk">{c.body}</span>
          </p>
        ))}
        {comments.length === 0 && (
          <p className="font-body text-xs text-steel">No feedback yet.</p>
        )}
      </div>

      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}

      {viewerId && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Add feedback"
            disabled={sending}
            className="flex-1 h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="h-8 px-2.5 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
