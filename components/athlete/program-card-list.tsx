"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface AthleteProgramCard {
  id: string;
  name: string;
  workoutCount: number;
  coverImagePath: string | null;
}

export function ProgramCardList({
  groupId,
  programs,
}: {
  groupId: string;
  programs: AthleteProgramCard[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {programs.map((p) => (
        <ProgramCard key={p.id} groupId={groupId} program={p} />
      ))}
    </div>
  );
}

function ProgramCard({ groupId, program }: { groupId: string; program: AthleteProgramCard }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!program.coverImagePath) return;
    const supabase = createBrowserClient();
    supabase.storage
      .from("program-covers")
      .createSignedUrl(program.coverImagePath, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [program.coverImagePath]);

  return (
    <Link
      href={`/groups/${groupId}/programs/${program.id}`}
      className="border border-steel/20 bg-surface/40 flex flex-col overflow-hidden active:bg-surface/60 transition-colors"
    >
      <div className="relative h-24 bg-graphite shrink-0">
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signedUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface to-graphite">
            <LayoutGrid className="w-6 h-6 text-steel/40" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="font-body font-medium text-sm text-chalk truncate">{program.name}</p>
        <p className="font-body text-xs text-steel mt-0.5">
          {program.workoutCount} {program.workoutCount === 1 ? "workout" : "workouts"}
        </p>
      </div>
    </Link>
  );
}
