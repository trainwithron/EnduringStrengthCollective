"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { demoThumbPath, youtubeEmbedUrl } from "@/lib/exercise-demo";

export interface DemoNeighbour {
  name: string;
  youtubeUrl: string | null;
}

// The exercise demo, big, in a sheet that slides up from the bottom of the screen (Ron, Oct 6). Never plays by itself; closing it (the Close button, the
// dark area, or Escape) drops the video so nothing keeps playing behind the workout. An uploaded video is signed only when the sheet is opened.
// Opened from the logger it can also step through the workout (Previous / Next, "N of M exercises") and shows the coach's notes and cues in a collapsible
// Exercise Details, so a client can look through the whole workout without closing it.
export function DemoSheet({
  title,
  youtubeUrl,
  videoUrl,
  videoPath,
  credit,
  details,
  nav,
  onClose,
}: {
  title: string;
  youtubeUrl: string | null;
  videoUrl?: string | null;
  videoPath?: string | null;
  credit?: string | null;
  details?: { notes: string | null; equipment: string | null } | null;
  nav?: { index: number; total: number; prev: DemoNeighbour | null; next: DemoNeighbour | null; onPrev: () => void; onNext: () => void };
  onClose: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(videoUrl ?? null);
  const [failed, setFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (signedUrl || !videoPath) return;
    let cancelled = false;
    createBrowserClient()
      .storage.from("exercise-media")
      .createSignedUrl(videoPath, 3600)
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.signedUrl) setSignedUrl(data.signedUrl);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedUrl, videoPath]);

  const embed = youtubeUrl ? youtubeEmbedUrl(youtubeUrl) : null;
  const hasDetails = !!(details && (details.notes || details.equipment));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={`${title} demo`}>
      <button type="button" aria-label="Close demo" onClick={onClose} className="absolute inset-0 bg-black/70" tabIndex={-1} />
      <div className="relative bg-graphite border-t border-steel/30 rounded-t-2xl px-4 pt-3 pb-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="font-display uppercase text-lg tracking-wide text-chalk min-w-0">{title}</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 h-11 px-5 rounded-full bg-surface border border-steel/40 font-body text-sm text-chalk active:border-rust"
          >
            Close
          </button>
        </div>
        <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
          {signedUrl ? (
            <video src={signedUrl} controls playsInline preload="metadata" className="w-full h-full" />
          ) : embed ? (
            <iframe
              src={embed}
              title={`${title} demo`}
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center px-4 text-center">
              <p className="font-body text-sm text-steel">
                {failed ? "This video could not be loaded. Try again in a moment." : videoPath ? "Loading the video…" : "There is no demo for this exercise yet."}
              </p>
            </div>
          )}
        </div>
        {youtubeUrl && (
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 font-body text-xs text-steel underline">
            Open in YouTube
          </a>
        )}
        {credit && <p className="font-body text-xs text-steel mt-2">Demo: {credit}</p>}

        {hasDetails && (
          <div className="mt-3 rounded-xl bg-surface border border-steel/20">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="w-full h-12 px-4 flex items-center gap-2 font-body text-sm text-chalk"
            >
              <Info className="w-4 h-4 text-steel" aria-hidden="true" />
              <span className="flex-1 text-left">Exercise details</span>
              <ChevronDown className={`w-4 h-4 text-steel transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {detailsOpen && (
              <div className="px-4 pb-4 space-y-2">
                {details?.notes && <p className="font-body text-sm text-chalk whitespace-pre-wrap">{details.notes}</p>}
                {details?.equipment && (
                  <p className="font-body text-xs text-steel">
                    Equipment: <span className="text-chalk">{details.equipment}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {nav && (
          <div className="mt-4 pt-3 border-t border-steel/20">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={nav.onPrev}
                disabled={!nav.prev}
                className="flex-1 min-w-0 h-14 flex items-center gap-2 text-left disabled:opacity-30 active:text-rust"
              >
                <ChevronLeft className="w-5 h-5 shrink-0 text-steel" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-body text-xs text-steel">Previous</span>
                  <span className="block font-body text-sm text-chalk truncate">{nav.prev?.name ?? ""}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={nav.onNext}
                disabled={!nav.next}
                className="flex-1 min-w-0 h-14 flex items-center justify-end gap-2 text-right disabled:opacity-30 active:text-rust"
              >
                <span className="min-w-0">
                  <span className="block font-body text-xs text-steel">Next</span>
                  <span className="block font-body text-sm text-chalk truncate">{nav.next?.name ?? ""}</span>
                </span>
                {nav.next && demoThumbPath(nav.next.youtubeUrl) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={demoThumbPath(nav.next.youtubeUrl)!} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                )}
                <ChevronRight className="w-5 h-5 shrink-0 text-steel" aria-hidden="true" />
              </button>
            </div>
            <p className="text-center font-body text-xs text-steel mt-1">
              {nav.index + 1} of {nav.total} exercises
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
