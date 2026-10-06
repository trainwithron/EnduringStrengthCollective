"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import {
  SHARE_FORMAT_LABELS,
  deliveryCapabilities,
  renderShareImageBlob,
  type ShareImageFormat,
  type ShareImageInput,
} from "@/lib/share-image";

// The share controls under the one-screen card. Share hands the finished PICTURE to the phone's own share sheet, so
// Instagram, Facebook, X and Messages all offer themselves; where a browser cannot do that, the picture is saved or
// copied instead. There is no link anywhere in this flow.
export function ShareActions({
  input,
  title,
  homeHref,
}: {
  input: Omit<ShareImageInput, "showName">;
  title: string;
  homeHref: string | null;
}) {
  const [format, setFormat] = useState<ShareImageFormat>("story");
  const [showName, setShowName] = useState(true);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The picture is made ahead of time (and again whenever a choice changes) so that tapping Share can open the
  // phone's share sheet at once; waiting to draw after the tap can lose the permission to open it.
  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    setFailed(false);
    renderShareImageBlob({ ...input, showName }, format)
      .then((b) => {
        if (!cancelled) setBlob(b);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // The input is fixed for this page; only the two choices change the picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, showName]);

  const file = useMemo(
    () => (blob ? new File([blob], `workout-${format}.png`, { type: "image/png" }) : null),
    [blob, format]
  );
  const caps = useMemo(
    () =>
      typeof navigator === "undefined"
        ? { nativeShare: false, copyImage: false }
        : deliveryCapabilities(navigator, typeof ClipboardItem !== "undefined", file),
    [file]
  );

  function say(message: string) {
    setNote(message);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 4000);
  }

  function save() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout-${format}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say("Saved. Post it from your photos.");
  }

  async function share() {
    if (!file || !blob) return;
    if (caps.nativeShare) {
      try {
        await navigator.share({ files: [file], title });
      } catch {
        // Closed the share sheet without choosing anything: not an error.
      }
      return;
    }
    save();
  }

  async function copy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      say("Picture copied. Paste it into your post.");
    } catch {
      say("Could not copy. Use Save image instead.");
    }
  }

  const ready = !!blob;

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Picture shape" className="flex flex-1 border border-steel/30">
          {(["story", "post"] as ShareImageFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              className={`flex-1 h-11 font-body text-sm font-medium transition-colors ${
                format === f ? "bg-rust text-graphite" : "text-steel"
              }`}
            >
              {SHARE_FORMAT_LABELS[f]}
              <span className="ml-1.5 text-xs opacity-70">{f === "story" ? "9:16" : "1:1"}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={showName}
          onClick={() => setShowName((v) => !v)}
          className={`h-11 px-3 border font-body text-sm whitespace-nowrap ${
            showName ? "border-rust text-rust" : "border-steel/30 text-steel"
          }`}
        >
          {showName ? "Name on" : "Name off"}
        </button>
      </div>

      <button
        type="button"
        onClick={share}
        disabled={!ready}
        className="w-full h-12 flex items-center justify-center gap-2 bg-rust text-graphite font-display uppercase text-sm font-bold active:bg-rust/80 transition-colors rounded-[14px] disabled:opacity-60 shadow-[0_8px_18px_-8px_rgba(210,112,59,.55)]"
      >
        <Share2 className="w-4 h-4" />
        {failed ? "Could not make the picture" : ready ? "Share picture" : "Making your picture…"}
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!ready}
          className="flex-1 h-11 flex items-center justify-center gap-1.5 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Save image
        </button>
        {caps.copyImage && (
          <button
            type="button"
            onClick={copy}
            disabled={!ready}
            className="flex-1 h-11 flex items-center justify-center gap-1.5 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
          >
            <Copy className="w-4 h-4" />
            Copy image
          </button>
        )}
      </div>

      <div className="flex items-center justify-between min-h-[28px]" aria-live="polite">
        {homeHref ? (
          <a href={homeHref} className="font-body text-xs text-steel underline underline-offset-2 py-2">
            Back to Home
          </a>
        ) : (
          <span />
        )}
        {note ? (
          <span className="font-body text-xs text-rust">{note}</span>
        ) : (
          <a href="#full-workout" className="font-body text-xs text-steel py-2">
            See full workout ↓
          </a>
        )}
      </div>
    </div>
  );
}
