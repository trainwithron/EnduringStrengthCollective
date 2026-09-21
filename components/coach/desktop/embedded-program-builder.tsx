"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { ProgramBuilderDesktop } from "./program-builder-desktop";
import { ProgrammingSpotterPanel } from "./programming-spotter-panel";
import { ProgramProgressBanner } from "../program-progress-banner";
import type { ProgramBuilderData } from "@/lib/program-builder-data";

// Real feedback from Ron on the traditional layout's resizable side
// panel: clicking into the Program mini-view's "open full builder"
// previously navigated away from whatever page he was on. This is the
// genuine picture-in-picture replacement — the SAME ProgramBuilderDesktop
// the full page uses, fetched client-side (via /api/coach/program-
// builder-data, since this panel is a client component and can't call
// the server-only getProgramBuilderData() the page itself uses) and
// rendered in place. Defaults to the group's shared active program —
// same simple default components/coach/desktop/program-mini-view.tsx
// already used, not a new "last viewed" tracking mechanism.
export function EmbeddedProgramBuilder({ groupId }: { groupId: string }) {
  const [programId, setProgramId] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<ProgramBuilderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveProgram() {
      const supabase = createBrowserClient();
      const { data: program } = await supabase
        .from("programs")
        .select("id")
        .eq("group_id", groupId)
        .eq("is_active", true)
        .is("athlete_id", null)
        .maybeSingle();
      if (!cancelled) setProgramId(program?.id ?? null);
    }
    resolveProgram();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    if (!programId) return;
    let cancelled = false;
    async function loadData() {
      setError(null);
      const response = await fetch(
        `/api/coach/program-builder-data?groupId=${groupId}&programId=${programId}`
      );
      if (!response.ok) {
        if (!cancelled) setError("Couldn't load this program.");
        return;
      }
      const { data: builderData } = await response.json();
      if (!cancelled) setData(builderData);
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [groupId, programId]);

  if (programId === undefined) {
    return <p className="font-body text-xs text-steel px-1">Loading…</p>;
  }
  if (programId === null) {
    return (
      <div>
        <p className="font-body text-xs text-steel px-1 mb-2">No active shared program yet.</p>
        <Link href={`/groups/${groupId}/programs/new`} className="font-body text-xs text-rust px-1">
          + New program &rarr;
        </Link>
      </div>
    );
  }
  if (error) {
    return <p className="font-body text-xs text-rust px-1">{error}</p>;
  }
  if (!data) {
    return <p className="font-body text-xs text-steel px-1">Loading…</p>;
  }

  return (
    <div>
      <Link
        href={`/groups/${groupId}/programs/${programId}`}
        className="block font-body text-xs text-rust px-1 mb-3"
      >
        Open full page &#8599;
      </Link>
      {data.dayProgress && (
        <ProgramProgressBanner
          programId={programId}
          dayNumber={data.dayProgress.dayNumber}
          totalDays={data.dayProgress.totalDays}
          totalVolumeLbs={data.totalVolumeLbs}
        />
      )}
      <ProgrammingSpotterPanel programId={programId} flags={data.spotterFlags} />
      <ProgramBuilderDesktop
        programId={data.programId}
        groupId={data.groupId}
        programName={data.programName}
        programDescription={data.programDescription}
        aiSequencingNotes={data.aiSequencingNotes}
        initialDays={data.initialDays}
        exerciseLibrary={data.exerciseLibrary}
        exerciseAliases={data.exerciseAliases}
        exerciseTierByName={data.exerciseTierByName}
        movementPatterns={data.movementPatterns}
        laddersByPattern={data.laddersByPattern}
        initialStartDate={data.initialStartDate}
        initialTrainingDays={data.initialTrainingDays}
        initialVisibilityWindow={data.initialVisibilityWindow}
        initialTrainingIntent={data.initialTrainingIntent}
        embedded
      />
    </div>
  );
}
