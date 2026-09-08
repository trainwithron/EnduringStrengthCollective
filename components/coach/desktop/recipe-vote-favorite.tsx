"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Heart, ChevronUp, ChevronDown } from "lucide-react";

// Recipe Hub v1 — voting + favoriting on top of the existing recipe
// database. Self-contained: fetches its own state on mount rather than
// needing the meal planner to pipe recipe data through server props.
export function RecipeVoteFavorite({ recipeId }: { recipeId: string }) {
  const [netScore, setNetScore] = useState(0);
  const [viewerVote, setViewerVote] = useState<0 | 1 | -1>(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);

      const [{ data: votes }, { data: favRow }] = await Promise.all([
        supabase.from("recipe_votes").select("profile_id, vote").eq("recipe_id", recipeId),
        supabase
          .from("recipe_favorites")
          .select("recipe_id")
          .eq("recipe_id", recipeId)
          .eq("profile_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      const score = (votes ?? []).reduce((sum, v) => sum + v.vote, 0);
      setNetScore(score);
      const mine = (votes ?? []).find((v) => v.profile_id === user.id);
      setViewerVote((mine?.vote as 0 | 1 | -1) ?? 0);
      setIsFavorited(!!favRow);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  async function handleVote(e: React.MouseEvent, value: 1 | -1) {
    e.stopPropagation();
    e.preventDefault();
    if (!userId) return;
    const supabase = createBrowserClient();
    const next = viewerVote === value ? 0 : value;
    if (next === 0) {
      await supabase
        .from("recipe_votes")
        .delete()
        .eq("profile_id", userId)
        .eq("recipe_id", recipeId);
    } else {
      await supabase
        .from("recipe_votes")
        .upsert({ profile_id: userId, recipe_id: recipeId, vote: next }, { onConflict: "profile_id,recipe_id" });
    }
    setNetScore((s) => s - viewerVote + next);
    setViewerVote(next);
  }

  async function handleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!userId) return;
    const supabase = createBrowserClient();
    if (isFavorited) {
      await supabase.from("recipe_favorites").delete().eq("profile_id", userId).eq("recipe_id", recipeId);
    } else {
      await supabase.from("recipe_favorites").insert({ profile_id: userId, recipe_id: recipeId });
    }
    setIsFavorited((v) => !v);
  }

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        onClick={(e) => handleVote(e, 1)}
        aria-label="Upvote recipe"
        className={`w-5 h-5 flex items-center justify-center ${
          viewerVote === 1 ? "text-positive" : "text-steel"
        }`}
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <span className="font-body text-[11px] text-steel w-4 text-center tabular-nums">{netScore}</span>
      <button
        type="button"
        onClick={(e) => handleVote(e, -1)}
        aria-label="Downvote recipe"
        className={`w-5 h-5 flex items-center justify-center ${
          viewerVote === -1 ? "text-rust" : "text-steel"
        }`}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleFavorite}
        aria-label={isFavorited ? "Remove favorite" : "Favorite recipe"}
        className="w-5 h-5 flex items-center justify-center ml-0.5"
      >
        <Heart className={`w-3.5 h-3.5 ${isFavorited ? "text-rust fill-rust" : "text-steel"}`} />
      </button>
    </div>
  );
}
