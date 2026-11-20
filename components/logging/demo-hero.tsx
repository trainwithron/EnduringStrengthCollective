"use client";

import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { demoThumbPath } from "@/lib/exercise-demo";
import { DemoSheet } from "./demo-sheet";

// The demo at the top of the exercise in the workout (Look Refresh, client step, Ron Nov 20): big, the full width of the card and about 16:9, with a play button. A tap plays it
// full screen in the demo sheet (the same sheet and the same video as before; it never plays by itself). The picture comes through our own route, never straight from YouTube; an
// uploaded video, or a YouTube video with no picture, shows a plain dark tile with the play button instead.
export function DemoHero({
  title,
  youtubeUrl,
  videoUrl,
  videoPath,
  onOpen,
}: {
  title: string;
  youtubeUrl: string | null;
  videoUrl?: string | null;
  videoPath?: string | null;
  // The workout's own demo sheet (steps through the exercises). Without it this opens its own sheet for this one demo.
  onOpen?: () => void;
}) {
  const src = demoThumbPath(youtubeUrl);
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        aria-label={`Play the ${title} demo, full screen`}
        data-demo-hero
        className="relative block w-full aspect-[16/9.5] max-h-[260px] rounded-[20px] overflow-hidden bg-surface-2 mb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rust"
      >
        {src && !broken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-16 h-16 rounded-full bg-rust text-graphite flex items-center justify-center shadow-[0_8px_28px_rgb(0_0_0/0.45)]">
            <Play className="w-7 h-7 translate-x-0.5" fill="currentColor" aria-hidden="true" />
          </span>
        </span>
        <span className="absolute left-3 bottom-3 rounded-full bg-graphite/80 px-2.5 py-1 font-body text-xs font-medium text-chalk">Demo</span>
        <span className="absolute right-3 bottom-3 rounded-full bg-graphite/80 px-2.5 py-1 font-body text-xs font-medium text-chalk">Tap for full screen</span>
      </button>
      {open && <DemoSheet title={title} youtubeUrl={youtubeUrl} videoUrl={videoUrl} videoPath={videoPath} onClose={close} />}
    </>
  );
}
