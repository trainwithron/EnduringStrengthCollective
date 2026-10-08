"use client";

import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { DemoSheet } from "@/components/logging/demo-sheet";
import { demoThumbPath } from "@/lib/exercise-demo";
import { demoCaption, type BuilderDemo } from "@/lib/builder-demo";

// A small picture of an exercise's demo video, for the program builder. The picture comes through our own route (lazy-loaded, cached), an uploaded video or a video with no picture shows a
// plain tile with the play mark, and tapping opens the same demo sheet the client sees (the exercise's coach notes appear in its Exercise details). An exercise with no video shows a
// quiet "No video yet" tile instead. size "tiny" is for the rows of the exercise dropdown (picture only, not tappable on its own); "card" is for the exercise card.
export function BuilderDemoThumb({
  exerciseName,
  demo,
  notes = null,
  size = "card",
  showCaption = true,
  onAddVideo,
}: {
  exerciseName: string;
  demo: BuilderDemo | null;
  notes?: string | null;
  size?: "card" | "tiny";
  showCaption?: boolean;
  // Opens the place where a video is added; offered on the "No video yet" tile when given.
  onAddVideo?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const tile = size === "tiny" ? "w-10 h-6 rounded" : "w-16 h-9 rounded-md";

  if (!demo) {
    const empty = (
      <span className={`${tile} shrink-0 flex items-center justify-center border border-dashed border-steel/30 text-steel font-body ${size === "tiny" ? "text-[8px]" : "text-[9px] leading-tight text-center"}`}>
        {size === "tiny" ? "" : "No video yet"}
      </span>
    );
    if (size === "tiny") return empty;
    return onAddVideo ? (
      <button type="button" onClick={onAddVideo} aria-label={`No video yet for ${exerciseName || "this exercise"}. Add one`} className="shrink-0 min-h-11 flex items-center">
        {empty}
      </button>
    ) : (
      <span className="shrink-0">{empty}</span>
    );
  }

  const src = demoThumbPath(demo.demo.youtubeUrl);
  const picture = (
    <span className={`${tile} relative shrink-0 block overflow-hidden bg-surface border border-steel/30`}>
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className={`${size === "tiny" ? "w-3.5 h-3.5" : "w-5 h-5"} rounded-full bg-black/60 flex items-center justify-center`}>
          <Play className={size === "tiny" ? "w-2 h-2 text-chalk" : "w-2.5 h-2.5 text-chalk"} fill="currentColor" aria-hidden="true" />
        </span>
      </span>
    </span>
  );
  if (size === "tiny") return picture;

  const caption = demoCaption(exerciseName, demo);
  return (
    <>
      <span className="shrink-0 flex flex-col items-start">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Watch the ${exerciseName || "exercise"} demo. ${caption}`}
          title={caption}
          className="min-h-11 flex items-center active:opacity-80"
        >
          {picture}
        </button>
        {showCaption && (
          <span className={`font-body text-[10px] leading-tight max-w-[72px] break-words ${demo.storedUnder ? "text-rust" : "text-steel"}`}>{demo.storedUnder ? caption : "Demo"}</span>
        )}
      </span>
      {open && (
        <DemoSheet
          title={exerciseName || "Exercise"}
          youtubeUrl={demo.demo.youtubeUrl}
          videoPath={demo.demo.videoPath}
          credit={demo.storedUnder}
          details={notes ? { notes, equipment: null } : null}
          onClose={close}
        />
      )}
    </>
  );
}
