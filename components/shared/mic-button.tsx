"use client";

import { useEffect, useRef, useState } from "react";

// A small microphone for any text box: tap, talk, and what was said is handed to onText. It uses the browser's own speech recognition (nothing is uploaded by us, no server),
// and simply does not appear in a browser without it. Reusable wherever a coach may talk instead of type.
// Optional: startLabel/stopLabel name the two states for screen readers; continuous keeps listening through pauses until tapped again (what was said is added as it is heard); unsupportedHint shows a
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
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.stop?.();
  }, []);

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
      recRef.current?.stop?.();
      return;
    }
    const w = window as any;
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = continuous;
    rec.onresult = (e: any) => {
      // Only what was newly finished: with continuous listening the results list keeps growing, so reading all of it again would repeat the earlier words.
      const said = Array.from(e.results as ArrayLike<any>)
        .slice(e.resultIndex ?? 0)
        .filter((r) => r.isFinal !== false)
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
      aria-label={listening ? stopLabel ?? "Stop listening" : startLabel ?? label}
      aria-pressed={listening}
      className={`min-h-11 min-w-11 px-2 border font-body text-xs ${listening ? "border-rust text-rust animate-pulse" : "border-steel/30 text-steel"}`}
    >
      {listening ? "Listening…" : "Mic"}
    </button>
  );
}
