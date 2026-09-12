"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { getDirectComparison, getBonusAnimalLine } from "@/lib/transformation-joke-bank";

export interface JournalPhotoOption {
  id: string;
  takenDate: string;
  signedUrl: string | null;
}

// The one moment in this whole feature where the athlete is actually in
// control of publishing anything — detection (the milestone that got us
// here) was fully automatic; everything from this screen onward is a
// deliberate choice, per the resolved design's own guardrail.
export function TransformationCardCreator({
  athleteId,
  groupId,
  milestoneId,
  startingWeight,
  currentWeight,
  windowStartDate,
  photos,
}: {
  athleteId: string;
  groupId: string;
  milestoneId: string;
  startingWeight: number;
  currentWeight: number;
  windowStartDate: string;
  photos: JournalPhotoOption[];
}) {
  const [humorEnabled, setHumorEnabled] = useState(true);
  const [beforePhotoId, setBeforePhotoId] = useState("");
  const [afterPhotoId, setAfterPhotoId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const totalLossLbs = Math.round((startingWeight - currentWeight) * 10) / 10;
  const directComparison = getDirectComparison(totalLossLbs, milestoneId);
  const bonusLine = getBonusAnimalLine(totalLossLbs, milestoneId);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("transformation_cards")
      .insert({
        athlete_id: athleteId,
        group_id: groupId,
        milestone_id: milestoneId,
        starting_weight: startingWeight,
        current_weight: currentWeight,
        window_start_date: windowStartDate,
        window_end_date: new Date().toISOString().slice(0, 10),
        humor_enabled: humorEnabled,
        before_photo_id: beforePhotoId || null,
        after_photo_id: afterPhotoId || null,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError("Couldn't create your card — try again.");
      setCreating(false);
      return;
    }
    router.push(`/share/transformation/${data.id}`);
  }

  return (
    <div>
      <div className="border border-rust/40 bg-surface/40 p-6 text-center mb-6">
        <p className="font-display font-bold text-4xl leading-none text-rust">
          Down {totalLossLbs} lbs
        </p>
        <p className="font-body text-xs text-steel mt-2 uppercase tracking-wide">
          since {new Date(`${windowStartDate}T00:00:00`).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>

        {humorEnabled && directComparison && (
          <p className="font-body text-sm text-chalk mt-4">{directComparison.text}</p>
        )}
        {humorEnabled && bonusLine && (
          <p className="font-body text-xs text-steel mt-2">{bonusLine}</p>
        )}
      </div>

      <label className="flex items-center gap-2 mb-4 font-body text-sm text-chalk">
        <input
          type="checkbox"
          checked={humorEnabled}
          onChange={(e) => setHumorEnabled(e.target.checked)}
        />
        Include the fun comparison lines
      </label>

      {photos.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="font-body text-xs text-steel uppercase tracking-wide">
            Optional: pick before/after photos from your journal
          </p>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={beforePhotoId}
              onChange={(e) => setBeforePhotoId(e.target.value)}
              className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            >
              <option value="">No &quot;before&quot; photo</option>
              {photos.map((p) => (
                <option key={p.id} value={p.id}>
                  Before — {p.takenDate}
                </option>
              ))}
            </select>
            <select
              value={afterPhotoId}
              onChange={(e) => setAfterPhotoId(e.target.value)}
              className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
            >
              <option value="">No &quot;after&quot; photo</option>
              {photos.map((p) => (
                <option key={p.id} value={p.id}>
                  After — {p.takenDate}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mb-3" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="w-full h-12 bg-rust text-graphite font-display uppercase text-sm font-bold disabled:opacity-40"
      >
        {creating ? "Creating…" : "Create & share"}
      </button>
    </div>
  );
}
