"use client";

import { useEffect, useRef, useState } from "react";
import { createMicSession } from "@/lib/mic-session";

// Sending what was said turns every listening mic off (Ron, Nov 24: "Submit on the program builder, it should turn the mic off automatically"). Call it at the start of a send; a mic inside a <form> also stops on its own when that form is submitted.
export const MIC_STOP_EVENT = "spotlight:mic-stop";
export function stopAllMics() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MIC_STOP_EVENT));
}

// A small microphone for any text box: tap, talk, and what was said is handed to onText. It uses the browser's own speech recognition (nothing is uploaded by us, no server),
// and simply does not appear in a browser without it. Reusable wherever a coach may talk instead of type.
// Optional: startLabel/stopLabel name the two states for screen readers; continuous keeps listening through pauses until tapped again (it starts again by itself when the browser ends a session on a silence, and
// what was said is added as it is heard, so nothing is lost; the logic is in lib/mic-session.ts); unsupportedHint shows a
// quiet disabled button with that tooltip in a browser that cannot do speech, instead of showing nothing.
export function MicButton({
  onText,
  label = "Speak instead of typing",
  startLabel,
  stopLabel,
  continuous = false,
  unsupportedHint,
}: {
  onText: (text: string) => void;
  label?: string;
  startLabel?: string;
  stopLabel?: string;
  continuous?: boolean;
  unsupportedHint?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<ReturnType<typeof createMicSession> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // false after a send stopped the mic: words the browser still hands over late are dropped, so nothing lands in the box that was just sent and cleared.
  const acceptText = useRef(true);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => sessionRef.current?.stop();
  }, []);

  // Stop on a send: the app-wide stop event, or the submit of the form this mic sits in.
  useEffect(() => {
    const stop = () => {
      acceptText.current = false;
      sessionRef.current?.stop();
    };
    window.addEventListener(MIC_STOP_EVENT, stop);
    const form = buttonRef.current?.closest("form") ?? null;
    form?.addEventListener("submit", stop);
    return () => {
      window.removeEventListener(MIC_STOP_EVENT, stop);
      form?.removeEventListener("submit", stop);
    };
  }, [supported]);

  if (!supported) {
    if (!unsupportedHint) return null;
    return (
      <button type="button" disabled title={unsupportedHint} aria-label={unsupportedHint} className="min-h-11 min-w-11 px-2 border border-steel/20 font-body text-xs text-steel/50 cursor-not-allowed">
        Mic
      </button>
    );
  }

  function toggle() {
    if (listening) {
      sessionRef.current?.stop();
      return;
    }
    const w = window as any;
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    acceptText.current = true;
    sessionRef.current = createMicSession({
      make: () => new Rec(),
      continuous,
      onText: (text) => {
        if (acceptText.current) onTextRef.current(text);
      },
      onListening: setListening,
    });
    sessionRef.current.start();
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      aria-label={listening ? stopLabel ?? "Stop listening" : startLabel ?? label}
      aria-pressed={listening}
      className={`min-h-11 min-w-11 px-2 border font-body text-xs ${listening ? "border-rust text-rust-ink animate-pulse" : "border-steel/30 text-steel"}`}
    >
      {listening ? "Listening…" : "Mic"}
    </button>
  );
}
