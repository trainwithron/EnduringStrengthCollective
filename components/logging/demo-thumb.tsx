"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { demoThumbPath } from "@/lib/exercise-demo";

// The demo on an exercise card: a small rounded picture of the video with a play mark, beside "Last time". Not intrusive, but there when needed: tapping it
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
      className="relative shrink-0 w-28 aspect-video rounded-xl overflow-hidden bg-surface border border-steel/30 active:border-rust"
    >
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
          <Play className="w-4 h-4 text-chalk" fill="currentColor" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
