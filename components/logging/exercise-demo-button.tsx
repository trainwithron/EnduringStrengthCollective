"use client";

import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { DemoSheet } from "./demo-sheet";

// A clear, one-tap way to see how an exercise is done: a "Demo" button that opens the demo in a sheet. Render it only when there is a demo; the caller decides
// whether this person has turned demos off (a client can, in Settings; a coach building a program always sees it).
export function ExerciseDemoButton({
  title,
  youtubeUrl,
  videoUrl,
  videoPath,
  credit,
  compact = false,
}: {
  title: string;
  youtubeUrl: string | null;
  videoUrl?: string | null;
  videoPath?: string | null;
  credit?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!youtubeUrl && !videoUrl && !videoPath) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Watch the ${title} demo`}
        className={`shrink-0 inline-flex items-center gap-1.5 border border-rust/60 text-rust font-body font-medium active:bg-rust active:text-graphite transition-colors ${
          compact ? "h-9 px-3 text-xs" : "h-11 px-4 text-sm"
        }`}
      >
        <Play className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden="true" fill="currentColor" />
        Demo
      </button>
      {open && <DemoSheet title={title} youtubeUrl={youtubeUrl} videoUrl={videoUrl} videoPath={videoPath} credit={credit} onClose={close} />}
    </>
  );
}
