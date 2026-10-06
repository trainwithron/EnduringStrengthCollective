"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { youtubeEmbedUrl } from "@/lib/exercise-demo";

// The exercise demo, big, in a sheet that slides up from the bottom of the screen (Ron, Oct 6). Never plays by itself; closing it (the Close button, the
// dark area, or Escape) drops the video so nothing keeps playing behind the workout. An uploaded video is signed only when the sheet is opened.
export function DemoSheet({
  title,
  youtubeUrl,
  videoUrl,
  videoPath,
  credit,
  onClose,
}: {
  title: string;
  youtubeUrl: string | null;
  videoUrl?: string | null;
  videoPath?: string | null;
  credit?: string | null;
  onClose: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(videoUrl ?? null);
  const [failed, setFailed] = useState(false);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={`${title} demo`}>
      <button type="button" aria-label="Close demo" onClick={onClose} className="absolute inset-0 bg-black/70" tabIndex={-1} />
      <div className="relative bg-graphite border-t border-steel/30 px-4 pt-3 pb-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="font-display uppercase text-base tracking-wide text-chalk">{title}</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 h-11 px-5 bg-surface border border-steel/40 font-body text-sm text-chalk active:border-rust"
          >
            Close
          </button>
        </div>
        <div className="w-full aspect-video bg-black">
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
                {failed ? "This video could not be loaded. Try again in a moment." : videoPath ? "Loading the video…" : "There is no demo for this exercise."}
              </p>
            </div>
          )}
        </div>
        {youtubeUrl && (
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 font-body text-xs text-steel underline">
            Open on YouTube
          </a>
        )}
        {credit && <p className="font-body text-xs text-steel mt-2">Demo: {credit}</p>}
      </div>
    </div>
  );
}
