"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { deliveryCapabilities, readShareTheme } from "@/lib/share-image";
import { readRecapTheme, renderRecapBlob, RECAP_SIZE, type RecapCardModel } from "@/lib/year-recap-card";

// The December recap picture on screen, and the only two ways it leaves the phone: Share (the phone's own share sheet, with the picture as a file) or Save
// (a download). It is drawn here, on the client's own phone, from their own numbers; nothing is posted and there is no link (wave 2, P7).
export function RecapPicture({ model }: { model: RecapCardModel }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    setFailed(false);
    renderRecapBlob(model, readRecapTheme(readShareTheme()))
      .then((b) => {
        if (cancelled) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
    // the model is fixed for the page; Try again draws it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const fileName = `my-${model.year}-recap.png`;
  const file = useMemo(() => (blob ? new File([blob], fileName, { type: "image/png" }) : null), [blob, fileName]);
  const caps = useMemo(
    () => (!inBrowser || typeof navigator === "undefined" ? { nativeShare: false, copyImage: false } : deliveryCapabilities(navigator, false, file)),
    [file, inBrowser]
  );

  function save() {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    setNote("Saved to your phone. It’s yours to post or keep.");
  }

  async function share() {
    if (!file) return;
    if (caps.nativeShare) {
      try {
        await navigator.share({ files: [file], title: `My ${model.year}` });
      } catch {
        // closed the share sheet: not an error
      }
      return;
    }
    save();
  }

  const ready = !!blob;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="mx-auto w-full max-w-[340px] rounded-card overflow-hidden bg-surface"
        style={{ aspectRatio: `${RECAP_SIZE.width} / ${RECAP_SIZE.height}` }}
        data-recap-preview
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={model.alt} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center px-6 text-center font-body text-sm text-steel" role="status">
            {failed ? "The picture didn’t load." : "Making your picture…"}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={failed ? () => setAttempt((a) => a + 1) : share}
        disabled={!ready && !failed}
        className="w-full h-[52px] inline-flex items-center justify-center gap-2 bg-rust text-graphite font-body text-base font-semibold disabled:opacity-60"
      >
        <Share2 className="w-4 h-4" aria-hidden="true" />
        {failed ? "Try again" : ready ? "Share" : "Making your picture…"}
      </button>
      <button
        type="button"
        onClick={save}
        disabled={!ready}
        className="w-full h-[52px] inline-flex items-center justify-center gap-2 rounded-[var(--btn-radius)] border border-steel/40 text-chalk font-body text-base disabled:opacity-60"
      >
        <Download className="w-4 h-4" aria-hidden="true" />
        Save
      </button>
      <p className="font-body text-[13px] text-steel text-center" aria-live="polite">
        {note ?? "Only you can see this. It stays private until you share it."}
      </p>
    </div>
  );
}
