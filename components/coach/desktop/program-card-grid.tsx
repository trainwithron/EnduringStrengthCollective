"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, ImagePlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ProgramActiveToggle } from "@/components/coach/program-active-toggle";
import { CardSizeToggle } from "@/components/coach/desktop/card-size-toggle";
import { ProgramCardMenu } from "@/components/coach/desktop/program-card-menu";
import { ProgramNameInput } from "@/components/coach/program-name-input";
import { ProgramCardVisual } from "@/components/coach/desktop/program-card-visual";
import { readCardSize, writeCardSize, type CardSize } from "@/lib/card-size";
import type { ProgramCardVisualData } from "@/lib/program-card-data";

export interface ProgramCardData {
  id: string;
  name: string;
  isActive: boolean;
  // Built by the AI and not yet signed off: not live, and Sign off replaces the Active switch.
  aiDraft?: boolean;
  workoutCount: number;
  // Half or more of its workout days are empty: it does not match its own shape (lib/program-completeness.ts).
  looksUnfinished?: boolean;
  coverImagePath: string | null;
  athleteId: string | null;
  athleteName: string | null;
  // The library program a client's own version was made from (set on a client's version only).
  sourceProgramId?: string | null;
  // How many people have their own version of this library program.
  assignedCount?: number;
  // The group the program belongs to, when the page lists programs from more than one group (the coach-level Programs page). Otherwise the grid's own group.
  groupId?: string;
}

const GRID_CLASS: Record<CardSize, string> = {
  small: "grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3",
  medium: "grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4",
  large: "grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5",
};

const IMAGE_HEIGHT: Record<CardSize, string> = {
  small: "h-20",
  medium: "h-32",
  large: "h-44",
};

const STORAGE_KEY = "esc-card-size-programs";

export function ProgramCardGrid({
  groupId,
  programs,
  visualsByProgramId = {},
}: {
  groupId: string;
  programs: ProgramCardData[];
  visualsByProgramId?: Record<string, ProgramCardVisualData>;
}) {
  const [size, setSize] = useState<CardSize>("medium");

  useEffect(() => {
    setSize(readCardSize(STORAGE_KEY));
  }, []);

  function handleSizeChange(next: CardSize) {
    setSize(next);
    writeCardSize(STORAGE_KEY, next);
  }

  if (programs.length === 0) {
    return (
      <p className="font-body text-sm text-steel py-6">
        No programs yet. Create one to start assigning workouts.
      </p>
    );
  }

  // One plain grid of cards, no inner headings: the page names the section (Programs, or the fold "Programs made for one client"). A client's own copy of a library program is never a card here (it is
  // reached from the program's "Assigned to" and the client's profile), so there is no per-client section to be empty.
  return (
    <div>
      <div className="flex justify-end mb-3">
        <CardSizeToggle size={size} onChange={handleSizeChange} />
      </div>
      <div className={`grid ${GRID_CLASS[size]}`}>
        {programs.map((p) => (
          <ProgramCard key={p.id} groupId={p.groupId ?? groupId} program={p} size={size} visual={visualsByProgramId[p.id]} />
        ))}
      </div>
    </div>
  );
}

function ProgramCard({
  groupId,
  program,
  size,
  visual,
}: {
  groupId: string;
  program: ProgramCardData;
  size: CardSize;
  visual?: ProgramCardVisualData;
}) {
  const [coverPath, setCoverPath] = useState(program.coverImagePath);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!coverPath) {
      setSignedUrl(null);
      return;
    }
    const supabase = createBrowserClient();
    supabase.storage
      .from("program-covers")
      .createSignedUrl(coverPath, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [coverPath]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    setUploading(true);
    const supabase = createBrowserClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${groupId}/${program.id}/cover-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("program-covers")
      .upload(path, file, { upsert: true });

    if (!uploadError) {
      const oldPath = coverPath;
      await supabase.from("programs").update({ cover_image_path: path }).eq("id", program.id);
      if (oldPath && oldPath !== path) {
        await supabase.storage.from("program-covers").remove([oldPath]);
      }
      setCoverPath(path);
    }
    setUploading(false);
  }

  const titleSize = size === "small" ? "text-sm" : size === "medium" ? "text-base" : "text-lg";

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg flex flex-col overflow-hidden group">
      <div className={`relative ${IMAGE_HEIGHT[size]} bg-graphite shrink-0`}>
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signedUrl} alt="" className="w-full h-full object-cover" />
        ) : visual ? (
          <ProgramCardVisual repsSeries={visual.repsSeries} weightSeries={visual.weightSeries} categorySplit={visual.categorySplit} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface to-graphite">
            <LayoutGrid className="w-6 h-6 text-steel" strokeWidth={1.5} />
          </div>
        )}
        <label className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-graphite/85 border border-steel/30 px-2 py-1 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
          <ImagePlus className="w-3 h-3 text-chalk" strokeWidth={2} />
          <span className="font-body text-xs text-chalk uppercase tracking-wide">
            {uploading ? "…" : signedUrl ? "Change" : "Add photo"}
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          {renaming ? (
            <ProgramNameInput programId={program.id} initial={program.name} onDone={() => setRenaming(false)} className="min-w-0 flex-1" />
          ) : (
          <Link href={`/groups/${groupId}/programs/${program.id}`} className="min-w-0 flex-1">
            <p className={`font-body font-medium ${titleSize} text-chalk truncate`}>
              {program.name}
              {program.looksUnfinished && (
                <span className="text-rust" title="Does this one need work? Many of its days have no exercises yet." aria-label="Looks unfinished. Does this one need work?">
                  {" "}
                  *
                </span>
              )}
            </p>
            <p className="font-body text-xs text-steel mt-0.5">
              {program.workoutCount} {program.workoutCount === 1 ? "workout" : "workouts"}
            </p>
            {!program.athleteId && (program.assignedCount ?? 0) > 0 && (
              <p className="font-body text-xs text-steel mt-0.5">Assigned to ({program.assignedCount})</p>
            )}
            {program.athleteName && (
              <p className="font-body text-xs text-rust mt-0.5 truncate">
                {program.athleteName}&apos;s program
              </p>
            )}
          </Link>
          )}
          <ProgramCardMenu onRename={() => setRenaming(true)} programId={program.id} programName={program.name} groupId={groupId} aiDraft={program.aiDraft} canHide={!program.athleteId && !program.isActive} showAssignButton={!program.athleteId && !program.isActive && !program.aiDraft} />
        </div>
        <div className="mt-auto flex items-center justify-between pt-2 border-t border-steel/15">
          <ProgramActiveToggle programId={program.id} isActive={program.isActive} aiDraft={program.aiDraft} programName={program.name} unassigned={!program.athleteId} />
          <Link href={`/groups/${groupId}/programs/${program.id}`} className="font-body text-xs text-rust">
            Open &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
