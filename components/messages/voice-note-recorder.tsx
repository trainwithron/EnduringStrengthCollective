"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, X } from "lucide-react";
import { VOICE_MAX_SECONDS, canRecordVoice, formatVoiceTime, pickVoiceMimeType, releaseAction, voiceExtension, voiceSeconds } from "@/lib/voice-note";

type Phase = "idle" | "asking" | "recording" | "review" | "sending";

// The microphone beside the message box (R7, Ron Nov 20), for a coach and a client alike. Hold it to talk and let go to send; or tap it, talk, then tap Send (or Cancel).
// While recording it shows how long so far, out of the 2 minutes a voice note can be; at 2 minutes it stops by itself and waits for Send or Cancel.
// The browser asks for the microphone only when the mic is tapped, never before. In a browser that cannot record, the mic is not shown at all.
export function VoiceNoteRecorder({
  disabled = false,
  onActiveChange,
  onSend,
}: {
  disabled?: boolean;
  // true while a recording is being made or waits to be sent: the message box steps aside for it
  onActiveChange?: (active: boolean) => void;
  // sends it; false keeps the recording so Send can be tapped again
  onSend: (audio: Blob, mimeType: string, seconds: number) => Promise<boolean>;
}) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const startedAtRef = useRef(0);
  const finalMsRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressAtRef = useRef<number | null>(null);
  const pointerStartedRef = useRef(false);

  useEffect(() => {
    setSupported(canRecordVoice(typeof window === "undefined" ? undefined : (window as unknown as Parameters<typeof canRecordVoice>[0])));
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        // already stopped
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    onActiveChange?.(phase !== "idle");
    // the parent's handler is read when the phase changes; a new function each render must not fire it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function releaseMic() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Stops the recorder and hands back what was recorded.
  function stopRecording(): Promise<Blob | null> {
    const rec = recorderRef.current;
    finalMsRef.current = Date.now() - startedAtRef.current;
    if (!rec || rec.state === "inactive") {
      releaseMic();
      return Promise.resolve(blobRef.current);
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        blobRef.current = blob;
        recorderRef.current = null;
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        releaseMic();
        resolve(null);
      }
    });
  }

  async function start() {
    if (phase !== "idle" || disabled) return;
    setNote(null);
    blobRef.current = null;
    chunksRef.current = [];
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("idle");
      setNote("The microphone is off for this site. Allow it in your browser's settings to record.");
      return;
    }
    const wanted = pickVoiceMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder));
    if (!wanted) {
      stream.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      setNote("This browser can't record a voice note.");
      return;
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: wanted });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      setNote("This browser can't record a voice note.");
      return;
    }
    // The type the browser really used, when the bucket takes it; otherwise the one asked for.
    mimeRef.current = rec.mimeType && voiceExtension(rec.mimeType) ? rec.mimeType : wanted;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    streamRef.current = stream;
    recorderRef.current = rec;
    rec.start(250);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setPhase("recording");
    tickRef.current = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      // At the limit it stops by itself and waits for Send or Cancel.
      if (ms >= VOICE_MAX_SECONDS * 1000) {
        void stopRecording().then(() => {
          setElapsedMs(VOICE_MAX_SECONDS * 1000);
          setPhase("review");
          setNote("That's 2 minutes, the longest a voice note can be.");
        });
      }
    }, 250);
  }

  async function cancel() {
    await stopRecording();
    blobRef.current = null;
    chunksRef.current = [];
    setNote(null);
    setPhase("idle");
  }

  async function send() {
    if (phase !== "recording" && phase !== "review") return;
    const blob = phase === "recording" ? await stopRecording() : blobRef.current;
    const seconds = voiceSeconds(Math.min(finalMsRef.current, VOICE_MAX_SECONDS * 1000));
    if (!blob || blob.size === 0 || seconds === null) {
      blobRef.current = null;
      setPhase("idle");
      setNote("Too short to send. Hold the mic a little longer.");
      return;
    }
    setPhase("sending");
    setNote(null);
    const ok = await onSend(blob, mimeRef.current, seconds);
    if (ok) {
      blobRef.current = null;
      chunksRef.current = [];
      setPhase("idle");
    } else {
      setPhase("review");
      setNote("Couldn't send. Check your connection and tap Send again.");
    }
  }

  // Hold to talk: a press held past a moment and let go sends; a short tap keeps recording.
  useEffect(() => {
    if (phase !== "asking" && phase !== "recording") return;
    function onUp() {
      const pressedAt = pressAtRef.current;
      pressAtRef.current = null;
      if (pressedAt === null) return;
      // let go while the browser was still asking about the microphone: treated as a tap (recording goes on, with Send and Cancel)
      if (phase === "asking") return;
      if (releaseAction(Date.now() - pressedAt) === "send") void send();
    }
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // send reads the current phase; it is re-bound whenever the phase changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!supported) return null;

  if (phase === "idle" || phase === "asking") {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Record a voice note (hold to talk, or tap)"
          title="Hold to talk, or tap to record"
          disabled={disabled || phase === "asking"}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            pointerStartedRef.current = true;
            pressAtRef.current = Date.now();
            void start();
          }}
          onClick={() => {
            // a keyboard press (no pointer) starts a recording that is sent with Send
            if (pointerStartedRef.current) {
              pointerStartedRef.current = false;
              return;
            }
            void start();
          }}
          onContextMenu={(e) => e.preventDefault()}
          className="h-11 w-11 inline-flex items-center justify-center rounded-token-pill border border-steel/30 text-chalk disabled:opacity-40 select-none touch-none"
        >
          <Mic className="w-5 h-5" aria-hidden="true" />
        </button>
        {note && (
          <p className="absolute bottom-full right-0 mb-2 w-64 bg-surface-2 rounded-card px-3 py-2 font-body text-xs text-chalk shadow" role="status">
            {note}
          </p>
        )}
      </div>
    );
  }

  const shownMs = phase === "recording" ? elapsedMs : Math.min(finalMsRef.current, VOICE_MAX_SECONDS * 1000);
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2" data-voice-recording>
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={phase === "sending"}
        aria-label="Cancel the voice note"
        className="h-11 w-11 inline-flex items-center justify-center rounded-token-pill border border-steel/30 text-chalk disabled:opacity-40 shrink-0"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0 h-11 flex items-center gap-2 px-3 rounded-token-pill tint-alert" role="status" aria-live="polite">
        {phase === "recording" && <span className="w-2.5 h-2.5 rounded-full bg-rust animate-pulse shrink-0" aria-hidden="true" />}
        <span className="font-body text-sm text-chalk tabular-nums">
          {formatVoiceTime(shownMs / 1000)} <span className="text-steel">/ {formatVoiceTime(VOICE_MAX_SECONDS)}</span>
        </span>
        <span className="font-body text-xs text-steel truncate">
          {phase === "sending" ? "Sending…" : note ?? (phase === "recording" ? "Recording" : "Ready to send.")}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void send()}
        disabled={phase === "sending"}
        aria-label="Send the voice note"
        className="h-11 px-4 inline-flex items-center gap-1.5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40 shrink-0"
      >
        <Send className="w-4 h-4" aria-hidden="true" />
        Send
      </button>
    </div>
  );
}
