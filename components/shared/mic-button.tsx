"use client";

import { useEffect, useRef, useState } from "react";

// A small microphone for any text box: tap, talk, and what was said is handed to onText. It uses the browser's own speech recognition (nothing is uploaded by us, no server),
// and simply does not appear in a browser without it. Reusable wherever a coach may talk instead of type.
export function MicButton({ onText, label = "Speak instead of typing" }: { onText: (text: string) => void; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.stop?.();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recRef.current?.stop?.();
      return;
    }
    const w = window as any;
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const said = Array.from(e.results as ArrayLike<any>)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) onText(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop listening" : label}
      aria-pressed={listening}
      className={`min-h-11 min-w-11 px-2 border font-body text-xs ${listening ? "border-rust text-rust" : "border-steel/30 text-steel"}`}
    >
      {listening ? "Listening…" : "Mic"}
    </button>
  );
}
