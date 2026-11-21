"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { VOICE_BUCKET, VOICE_LINK_SECONDS, formatVoiceTime } from "@/lib/voice-note";

// One voice note in a conversation: play or pause, how long it is, and how far it has played. The sound is fetched only when Play is tapped, through a short-lived link made
// under the listener's own sign-in (storage lets only the two people in the conversation open it), and a fresh link is asked for when the last one is near its end.
// The length shown is the one stored with the message: a browser's own reading of a recording's length is often missing for this kind of file.
export function VoiceNotePlayer({ path, seconds, own }: { path: string; seconds: number; own: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const linkAt = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function toggle() {
    if (loading) return;
    const current = audioRef.current;
    if (current && playing) {
      current.pause();
      return;
    }
    setFailed(false);
    let audio = current;
    // A link lasts five minutes: one older than four is replaced before playing (from where it stopped).
    if (!audio || Date.now() - linkAt.current > (VOICE_LINK_SECONDS - 60) * 1000) {
      setLoading(true);
      const { data, error } = await createBrowserClient().storage.from(VOICE_BUCKET).createSignedUrl(path, VOICE_LINK_SECONDS);
      setLoading(false);
      if (error || !data?.signedUrl) {
        setFailed(true);
        return;
      }
      const resumeAt = audio?.currentTime ?? 0;
      audio?.pause();
      audio = new Audio(data.signedUrl);
      audio.preload = "auto";
      if (resumeAt > 0) audio.currentTime = resumeAt;
      audio.addEventListener("timeupdate", () => setAt(audio!.currentTime));
      audio.addEventListener("play", () => setPlaying(true));
      audio.addEventListener("pause", () => setPlaying(false));
      audio.addEventListener("ended", () => {
        setPlaying(false);
        setAt(0);
        if (audio) audio.currentTime = 0;
      });
      audio.addEventListener("error", () => {
        setPlaying(false);
        setFailed(true);
      });
      audioRef.current = audio;
      linkAt.current = Date.now();
    }
    try {
      await audio.play();
    } catch {
      setFailed(true);
    }
  }

  const total = Math.max(1, seconds);
  const shown = playing || at > 0 ? at : total;
  const pct = Math.min(100, Math.max(0, (at / total) * 100));

  return (
    <div className="flex items-center gap-2.5 min-w-[200px]" data-voice-note>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={`inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-token-pill ${own ? "bg-graphite/20 text-graphite" : "bg-surface-2 text-chalk"} disabled:opacity-50`}
        disabled={loading}
      >
        {playing ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`h-1.5 rounded-token-pill overflow-hidden ${own ? "bg-graphite/25" : "bg-steel/25"}`}
          role="progressbar"
          aria-label="Played"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.round(at)}
        >
          <div className={`h-full ${own ? "bg-graphite" : "bg-rust"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`block mt-1 text-[11px] tabular-nums ${own ? "text-graphite/80" : "text-steel"}`}>
          {loading ? "Loading…" : failed ? "Couldn't play. Tap to try again." : formatVoiceTime(shown)}
        </span>
      </div>
    </div>
  );
}
