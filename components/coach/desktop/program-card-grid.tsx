"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, ImagePlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ProgramActiveToggle } from "@/components/coach/program-active-toggle";
import { CardSizeToggle } from "@/components/coach/desktop/card-size-toggle";
import { readCardSize, writeCardSize, type CardSize } from "@/lib/card-size";

export interface ProgramCardData {
  id: string;
  name: string;
  isActive: boolean;
  workoutCount: number;
  coverImagePath: string | null;
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
}: {
  groupId: string;
  programs: ProgramCardData[];
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

  return (
    <div>
      <div className="flex justify-end mb-3">
        <CardSizeToggle size={size} onChange={handleSizeChange} />
      </div>
      <div className={`grid ${GRID_CLASS[size]}`}>
        {programs.map((p) => (
          <ProgramCard key={p.id} groupId={groupId} program={p} size={size} />
        ))}
      </div>
    </div>
  );
}

function ProgramCard({
  groupId,
  program,
  size,
}: {
  groupId: string;
  program: ProgramCardData;
  size: CardSize;
}) {
  const [coverPath, setCoverPath] = useState(program.coverImagePath);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
    <div className="border border-steel/20 bg-surface/40 flex flex-col overflow-hidden group">
      <div className={`relative ${IMAGE_HEIGHT[size]} bg-graphite shrink-0`}>
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signedUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface to-graphite">
            <LayoutGrid className="w-6 h-6 text-steel/40" strokeWidth={1.5} />
          </div>
        )}
        <label className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-graphite/85 border border-steel/30 px-2 py-1 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
          <ImagePlus className="w-3 h-3 text-chalk" strokeWidth={2} />
          <span className="font-body text-[10px] text-chalk uppercase tracking-wide">
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
        <Link href={`/groups/${groupId}/programs/${program.id}`} className="min-w-0">
          <p className={`font-body font-medium ${titleSize} text-chalk truncate`}>{program.name}</p>
          <p className="font-body text-xs text-steel mt-0.5">
            {program.workoutCount} {program.workoutCount === 1 ? "workout" : "workouts"}
          </p>
        </Link>
        <div className="mt-auto flex items-center justify-between pt-2 border-t border-steel/15">
          <ProgramActiveToggle programId={program.id} groupId={groupId} isActive={program.isActive} />
          <Link href={`/groups/${groupId}/programs/${program.id}`} className="font-body text-xs text-rust">
            Open &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
