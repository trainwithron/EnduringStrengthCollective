"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { announceWorkoutLog } from "@/lib/announce-workout-log";

// The client's one-tap answer. Yes: that imported workout becomes a real logged workout dated when it was done (one database function), then the card and the feed post are made exactly as when a
// workout is finished (lib/announce-workout-log.ts) and the client lands on their celebration card. Not now: nothing changes.
export function PrPromotionAnswerCard({ promotionId, groupId, athleteId, postCard = true }: { promotionId: string; groupId: string; athleteId: string; postCard?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data: logId, error: problem } = await supabase.rpc("answer_pr_promotion", { p_id: promotionId, p_accept: accept });
    if (problem) {
      setBusy(false);
      setError("Couldn't save your answer. Try again.");
      return;
    }
    if (!accept || !logId) {
      router.push(`/groups/${groupId}`);
      router.refresh();
      return;
    }
    // The group has its post-workout cards switched off: the record counts, nothing is posted or offered to share.
    if (!postCard) {
      router.push(`/groups/${groupId}`);
      router.refresh();
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("feed_broadcast_level").eq("id", athleteId).maybeSingle();
    const announced = await announceWorkoutLog(supabase, {
      workoutLogId: logId as string,
      athleteId,
      groupId,
      broadcastLevel: (profile?.feed_broadcast_level as string | null) ?? "full",
      hasPrs: true,
    });
    router.push(announced.href ?? `/groups/${groupId}`);
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void answer(true)} className="min-h-11 bg-rust text-graphite font-display font-bold uppercase tracking-wide px-5 disabled:opacity-40">
        {busy ? "Saving…" : "Count it"}
      </button>
      <button type="button" disabled={busy} onClick={() => void answer(false)} className="min-h-11 border border-steel/40 px-5 font-body text-sm text-chalk disabled:opacity-40">
        Not now
      </button>
      {error && (
        <p className="w-full font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
