"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { FOOD_FAVORITES_CHANGED, favoriteFromEntry } from "@/lib/food-favorites";

// A small star on something the client logged: save it as a favorite food, or take it off. The macros saved are the ones on the entry right now. Shows
// nothing until the favorites update (0286) is applied, and nothing for an entry that has no name or calories.
export function FavoriteStar({
  profileId,
  entry,
  fallbackLabel,
}: {
  profileId: string;
  entry: { description: string | null; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
  fallbackLabel?: string | null;
}) {
  const fav = favoriteFromEntry(entry, fallbackLabel);
  const [state, setState] = useState<"unknown" | "off" | "on" | "unavailable">("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = fav?.key ?? null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const { data, error: loadError } = await supabase.from("recipe_favorites").select("recipe_id").eq("profile_id", profileId).eq("recipe_id", key as string).maybeSingle();
      if (cancelled) return;
      if (loadError) setState("unavailable");
      else setState(data ? "on" : "off");
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [profileId, key]);

  if (!fav || state === "unknown" || state === "unavailable") return null;

  async function toggle() {
    if (!fav) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    if (state === "on") {
      const { error: deleteError } = await supabase.from("recipe_favorites").delete().eq("profile_id", profileId).eq("recipe_id", fav.key);
      if (deleteError) setError("That didn't save. Try again.");
      else setState("off");
    } else {
      const { error: insertError } = await supabase.from("recipe_favorites").insert({
        profile_id: profileId,
        recipe_id: fav.key,
        kind: "food",
        label: fav.label,
        calories: fav.calories,
        protein_g: fav.proteinG,
        carbs_g: fav.carbsG,
        fat_g: fav.fatG,
      });
      if (insertError) setError(/up to 60/.test(insertError.message) ? "You can keep up to 60 favorite foods. Remove one to add another." : "That didn't save. Try again.");
      else setState("on");
    }
    setBusy(false);
    window.dispatchEvent(new Event(FOOD_FAVORITES_CHANGED));
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={state === "on"}
        aria-label={state === "on" ? `Remove ${fav.label} from favorites` : `Save ${fav.label} as a favorite`}
        className={`h-8 px-2 font-body text-xs border disabled:opacity-40 ${state === "on" ? "border-rust text-rust" : "border-steel/30 text-steel"}`}
      >
        {state === "on" ? "★ Favorite" : "☆ Save as favorite"}
      </button>
      {error && (
        <span className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
