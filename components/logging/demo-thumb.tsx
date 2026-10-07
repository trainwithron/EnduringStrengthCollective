"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { demoThumbPath } from "@/lib/exercise-demo";

// The demo on an exercise card: a rounded picture of the video with a play mark, beside "Last time". Big enough to read as a video (a client asked for it bigger), still not in the way: tapping it
// opens the demo sheet. The picture comes through our own route (never straight from YouTube); an uploaded video, or a YouTube video with no picture, shows
// a plain tile with the play mark instead.
export function DemoThumb({ title, youtubeUrl, onOpen }: { title: string; youtubeUrl: string | null; onOpen: () => void }) {
  const src = demoThumbPath(youtubeUrl);
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Watch the ${title} demo`}
      className="relative shrink-0 w-full max-w-[208px] min-[380px]:w-40 min-[380px]:max-w-none sm:w-52 aspect-video rounded-xl overflow-hidden bg-surface border border-steel/30 active:border-rust"
    >
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center">
          <Play className="w-5 h-5 text-chalk" fill="currentColor" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
