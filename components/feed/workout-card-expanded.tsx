"use client";

import { useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { getVolumeEquivalence } from "@/lib/volume-equivalence";

interface SharedWorkoutData {
  groupName: string;
  athleteName: string;
  broadcastLevel: "full" | "prs_only" | "checkin_only";
  totalVolume: number | null;
  totalSetsCompleted: number | null;
  topLifts: { name: string; weight: number; reps: number }[];
  prList: { name: string; weight: number; reps: number; oneRepMax: number }[];
  createdAt: string;
}

export function WorkoutCardExpanded({ postId }: { postId: string }) {
  const [data, setData] = useState<SharedWorkoutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workout-share/${postId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this workout's details.");
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function handleShareScreenshot() {
    if (!cardRef.current) return;
    setCapturing(true);
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error("capture failed");
      const file = new File([blob], "workout-card.png", { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My workout" });
      } else {
        // No native share-with-files support (most desktop browsers) —
        // hand back a real downloadable image instead of a dead end.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "workout-card.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setError("Couldn't create the image — try again.");
    } finally {
      setCapturing(false);
    }
  }

  if (error) {
    return <p className="font-body text-xs text-rust mt-3">{error}</p>;
  }
  if (!data) {
    return <p className="font-body text-xs text-steel mt-3">Loading…</p>;
  }

  const volumeEquivalence =
    data.totalVolume != null ? getVolumeEquivalence(data.totalVolume) : null;

  return (
    <div className="mt-3">
      <div
        ref={cardRef}
        className="border border-rust/40 bg-surface p-6 text-center"
      >
        <p className="font-display uppercase text-xs tracking-[0.2em] text-rust">
          {data.groupName}
        </p>
        <h3 className="font-display font-bold text-2xl uppercase leading-tight mt-3">
          {data.prList.length > 0 ? "New PR 🎉" : "Workout Complete 💪"}
        </h3>
        <p className="font-body text-base mt-1">{data.athleteName}</p>

        {data.totalVolume != null && (
          <div className="mt-5 pb-4 border-b border-steel/20">
            <p className="font-display text-4xl leading-none">
              {Math.round(data.totalVolume).toLocaleString()}
            </p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
              lbs total volume &middot; {data.totalSetsCompleted} sets
            </p>
            {volumeEquivalence && (
              <p className="font-body text-sm text-rust mt-2">
                That&apos;s the weight of {volumeEquivalence.label}
              </p>
            )}
          </div>
        )}

        {data.topLifts.length > 0 && (
          <div className="mt-4">
            <p className="font-body text-xs text-steel uppercase tracking-wide mb-2">
              Top lifts today
            </p>
            <div className="space-y-1.5">
              {data.topLifts.map((lift) => (
                <div key={lift.name} className="flex items-center justify-between">
                  <span className="font-display text-sm uppercase">{lift.name}</span>
                  <span className="font-body text-xs text-steel">
                    {lift.weight} lbs &times; {lift.reps}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.prList.length > 0 && (
          <div className="mt-4 pt-4 border-t border-steel/20">
            <p className="font-body text-xs text-rust uppercase tracking-wide mb-2">
              New PRs
            </p>
            <div className="space-y-1">
              {data.prList.map((pr) => (
                <p key={pr.name} className="font-body text-sm">
                  {pr.name}: {pr.weight} lbs &times; {pr.reps} (est. 1RM {pr.oneRepMax})
                </p>
              ))}
            </div>
          </div>
        )}

        <p className="font-body text-xs text-steel mt-5">
          {new Date(data.createdAt).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      <button
        type="button"
        onClick={handleShareScreenshot}
        disabled={capturing}
        className="w-full h-10 mt-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
      >
        {capturing ? "Preparing image…" : "Share as image"}
      </button>
    </div>
  );
}
