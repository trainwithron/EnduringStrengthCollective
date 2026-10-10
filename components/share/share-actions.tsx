"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { deliveryCapabilities, renderShareImageBlob, type ShareImageFormat, type ShareImageInput } from "@/lib/share-image";

// The share controls under the one-screen card: ONE primary Share, then quiet extras. Share hands the finished PICTURE to the phone's own share sheet, so
// Instagram, Facebook, X and Messages all offer themselves; where a browser cannot do that, the picture is saved instead (and Save / Copy sit in a small menu).
// The picture is always the 9:16 story shape with the first name on; there are no shape or name choices. There is no link anywhere in this flow.
const FORMAT: ShareImageFormat = "story";
export function ShareActions({
  input,
  title,
  homeHref,
  hold = false,
}: {
  input: Omit<ShareImageInput, "showName">;
  title: string;
  homeHref: string | null;
  // True while the fun line is still being chosen: the picture is not drawn yet (it would be drawn twice).
  hold?: boolean;
}) {
  const format = FORMAT;
  const showName = true;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The picture is made ahead of time (and again when the fun line changes) so that tapping Share can open the
  // phone's share sheet at once; waiting to draw after the tap can lose the permission to open it.
  useEffect(() => {
    if (hold) return;
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
    // The input is fixed for this page; the fun line is what changes the picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.funLine, hold]);

  const file = useMemo(
    () => (blob ? new File([blob], `workout-${format}.png`, { type: "image/png" }) : null),
    [blob, format]
  );
  // What this browser can do is only known once it is running in the browser. The server (and the first browser render) assume nothing, so the two agree and
  // the Copy button appears right after, instead of a mismatch between the server page and the browser.
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);
  const caps = useMemo(
    () =>
      !inBrowser || typeof navigator === "undefined"
        ? { nativeShare: false, copyImage: false }
        : deliveryCapabilities(navigator, typeof ClipboardItem !== "undefined", file),
    [file, inBrowser]
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
    <div className="shrink-0 space-y-1.5">
      <button
        type="button"
        onClick={share}
        disabled={!ready}
        className="w-full h-12 flex items-center justify-center gap-2 bg-rust text-graphite font-display uppercase text-sm font-bold active:bg-rust/80 transition-colors rounded-[14px] disabled:opacity-60 shadow-[0_8px_18px_-8px_rgba(210,112,59,.55)]"
      >
        <Share2 className="w-4 h-4" />
        {failed ? "Could not make the picture" : ready ? "Share" : "Making your picture…"}
      </button>

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
          <details className="relative">
            <summary className="font-body text-xs text-steel py-2 cursor-pointer list-none">Save or copy</summary>
            <div className="absolute right-0 bottom-full mb-1 z-10 w-40 border border-steel/30 bg-graphite">
              <button
                type="button"
                onClick={save}
                disabled={!ready}
                className="w-full h-11 flex items-center gap-2 px-3 text-chalk font-body text-sm disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Save image
              </button>
              {caps.copyImage && (
                <button
                  type="button"
                  onClick={copy}
                  disabled={!ready}
                  className="w-full h-11 flex items-center gap-2 px-3 text-chalk font-body text-sm border-t border-steel/20 disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" />
                  Copy image
                </button>
              )}
            </div>
          </details>
        )}
        <a href="#full-workout" className="font-body text-xs text-steel py-2">
          See full workout ↓
        </a>
      </div>
    </div>
  );
}
