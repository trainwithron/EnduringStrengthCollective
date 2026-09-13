"use client";

import { useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { notifyPush } from "@/lib/push-notify";

// Coach video check-ins (coach_video_checkin_idea memory) — the mirror
// of the athlete's own video-feedback loop. Real, in-browser recording
// via MediaRecorder (no native app needed), rough typed notes turned
// into a polished summary + action list by AI, saved together in one
// submit. The video itself is for the athlete to watch; the AI only
// ever sees the coach's typed notes, never the video/audio.
export function VideoCheckinRecorder({
  athleteId,
  groupId,
  coachId,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoElRef = useRef<HTMLVideoElement>(null);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoElRef.current) {
        videoElRef.current.srcObject = stream;
        videoElRef.current.muted = true;
        await videoElRef.current.play();
      }
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        setVideoBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Couldn't access your camera/microphone — check browser permissions.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function retake() {
    setVideoBlob(null);
    setPreviewUrl(null);
  }

  async function handleGenerate() {
    if (!notes.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/video-checkin/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't generate a summary.");
        return;
      }
      setSummary(data.summary);
      setActionItems(data.actionItems);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!videoBlob) return;
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();

    const path = `${groupId}/${athleteId}/${crypto.randomUUID()}.webm`;
    const { error: uploadError } = await supabase.storage.from("coach-video-checkins").upload(path, videoBlob, {
      contentType: "video/webm",
    });
    if (uploadError) {
      setError("Couldn't upload the video — try again.");
      setSaving(false);
      return;
    }

    const { data: checkin, error: insertError } = await supabase
      .from("coach_video_checkins")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        video_path: path,
        coach_notes: notes,
        ai_summary: summary || null,
        created_by: coachId,
      })
      .select("id")
      .single();

    if (insertError || !checkin) {
      setError("Video uploaded, but the check-in couldn't be saved — try again.");
      setSaving(false);
      return;
    }

    if (actionItems.length > 0) {
      await supabase.from("coach_video_checkin_action_items").insert(
        actionItems.map((body, i) => ({
          checkin_id: checkin.id,
          group_id: groupId,
          athlete_id: athleteId,
          body,
          sort_order: i,
        }))
      );
    }

    notifyPush(athleteId, "New video check-in", "Your coach just sent you a video check-in.", `/groups/${groupId}/video-checkins`);

    setSaving(false);
    setDone(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 px-4 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors"
      >
        🎥 Record check-in
      </button>
    );
  }

  if (done) {
    return (
      <div className="border border-positive/40 p-4">
        <p className="font-body text-sm text-chalk">Check-in sent.</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDone(false);
            setVideoBlob(null);
            setPreviewUrl(null);
            setNotes("");
            setSummary("");
            setActionItems([]);
          }}
          className="font-body text-xs text-rust mt-2"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="border border-steel/20 p-4 space-y-3 max-w-md">
      <div className="flex items-center justify-between">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide">Video check-in</h3>
        <button type="button" onClick={() => setOpen(false)} className="font-body text-xs text-steel">
          Cancel
        </button>
      </div>

      {!previewUrl ? (
        <>
          <video ref={videoElRef} className="w-full bg-graphite aspect-video" playsInline />
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium"
            >
              Start recording
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="h-10 px-4 bg-chalk text-graphite font-body text-sm font-medium"
            >
              ● Stop
            </button>
          )}
        </>
      ) : (
        <>
          <video src={previewUrl} controls className="w-full bg-graphite aspect-video" />
          <button type="button" onClick={retake} className="font-body text-xs text-steel">
            Re-record
          </button>

          <label className="flex flex-col gap-1">
            <span className="font-body text-[10px] text-steel uppercase tracking-wide">
              Rough notes (AI turns these into a summary + action items)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="e.g. squat depth improving, still rushing the eccentric, cue to breathe at the top..."
              className="bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !notes.trim()}
            className="h-9 px-3 border border-rust/40 text-rust font-body text-xs font-medium disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate summary + action items"}
          </button>

          {summary && (
            <div className="border border-steel/20 p-3 space-y-2">
              <p className="font-body text-sm text-chalk">{summary}</p>
              {actionItems.length > 0 && (
                <ul className="space-y-1">
                  {actionItems.map((item, i) => (
                    <li key={i} className="font-body text-xs text-steel">
                      &bull; {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-10 px-4 w-full bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {saving ? "Sending…" : "Send check-in"}
          </button>
        </>
      )}
      {error && !previewUrl && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
