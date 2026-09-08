"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface ChallengeHabitRow {
  id: string;
  title: string;
}

export function ChallengeParticipantPanel({
  challengeId,
  groupId,
  isJoined,
  isJoinable,
  todayKey,
  habits,
  completedHabitIdsToday,
  beforePhotoUrl,
  afterPhotoUrl,
  hasEnded,
}: {
  challengeId: string;
  groupId: string;
  isJoined: boolean;
  isJoinable: boolean;
  todayKey: string;
  habits: ChallengeHabitRow[];
  completedHabitIdsToday: string[];
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  hasEnded: boolean;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [completed, setCompleted] = useState(new Set(completedHabitIdsToday));
  const [uploading, setUploading] = useState<"before" | "after" | null>(null);

  async function handleJoin() {
    setJoining(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setJoining(false);
      return;
    }
    await supabase.from("challenge_participants").insert({
      challenge_id: challengeId,
      profile_id: user.id,
    });
    setJoining(false);
    router.refresh();
  }

  async function toggleHabit(habitId: string) {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const isDone = completed.has(habitId);
    if (isDone) {
      await supabase
        .from("challenge_habit_logs")
        .delete()
        .eq("challenge_habit_id", habitId)
        .eq("profile_id", user.id)
        .eq("log_date", todayKey);
      setCompleted((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    } else {
      await supabase.from("challenge_habit_logs").upsert(
        {
          challenge_habit_id: habitId,
          profile_id: user.id,
          log_date: todayKey,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "challenge_habit_id,profile_id,log_date" }
      );
      setCompleted((prev) => new Set(prev).add(habitId));
    }
    router.refresh();
  }

  async function handlePhoto(kind: "before" | "after", file: File) {
    setUploading(kind);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploading(null);
      return;
    }
    const path = `${groupId}/challenges/${challengeId}/${user.id}-${kind}-${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("post-media").upload(path, file);
    if (!uploadError) {
      const { data: signed } = await supabase.storage
        .from("post-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const column = kind === "before" ? "before_photo_url" : "after_photo_url";
      await supabase
        .from("challenge_participants")
        .update({ [column]: signed?.signedUrl ?? null })
        .eq("challenge_id", challengeId)
        .eq("profile_id", user.id);
    }
    setUploading(null);
    router.refresh();
  }

  if (!isJoined) {
    return (
      <div className="border border-steel/20 p-4">
        {isJoinable ? (
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            className="h-10 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {joining ? "Joining…" : "Join challenge"}
          </button>
        ) : (
          <p className="font-body text-sm text-steel">This challenge isn&apos;t open to join right now.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-steel/20 p-4">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
          Today&apos;s habits
        </h3>
        <div className="space-y-2">
          {habits.map((h) => (
            <label key={h.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={completed.has(h.id)}
                onChange={() => toggleHabit(h.id)}
                className="w-4 h-4"
              />
              <span
                className={`font-body text-sm ${completed.has(h.id) ? "text-positive" : "text-chalk"}`}
              >
                {h.title}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border border-steel/20 p-4">
        <h3 className="font-body text-xs text-steel uppercase tracking-wide mb-2">
          Before &amp; after
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="font-body text-[11px] text-steel mb-1">Day 1</p>
            {beforePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={beforePhotoUrl} alt="Before" className="w-full aspect-square object-cover" />
            ) : (
              <label className="w-full aspect-square border border-dashed border-steel/40 flex items-center justify-center cursor-pointer">
                <span className="font-body text-xs text-steel">
                  {uploading === "before" ? "Uploading…" : "Upload"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handlePhoto("before", e.target.files[0])}
                />
              </label>
            )}
          </div>
          <div>
            <p className="font-body text-[11px] text-steel mb-1">
              {hasEnded ? "Final" : "Latest"}
            </p>
            {afterPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={afterPhotoUrl} alt="After" className="w-full aspect-square object-cover" />
            ) : (
              <label className="w-full aspect-square border border-dashed border-steel/40 flex items-center justify-center cursor-pointer">
                <span className="font-body text-xs text-steel">
                  {uploading === "after" ? "Uploading…" : "Upload"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handlePhoto("after", e.target.files[0])}
                />
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
