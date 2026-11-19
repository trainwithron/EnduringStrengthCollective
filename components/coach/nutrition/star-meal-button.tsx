"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { STARRED_MEALS_CHANGED, starInsertRow, type StarredMeal } from "@/lib/starred-meals";

// The star on a meal the coach sees (a planner option, a meal from before a plan change, a meal a client logged). Tapping it adds the meal to the coach's Favorite meals, or takes it
// off. The coach's stars are read ONCE per page (not once per star), and every star with the same meal changes together.
let starred: Promise<{ userId: string | null; keys: Set<string> }> | null = null;

function loadStarred() {
  if (!starred) {
    starred = (async () => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { userId: null, keys: new Set<string>() };
      const { data, error } = await supabase.from("recipe_favorites").select("recipe_id").eq("profile_id", user.id).eq("kind", "meal").limit(500);
      // A failed read shows every star empty; a tap then tries the write and says if it did not save.
      return { userId: user.id, keys: new Set(error ? [] : (data ?? []).map((r) => r.recipe_id as string)) };
    })();
  }
  return starred;
}

export function StarMealButton({ star, onChange }: { star: StarredMeal | null; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const key = star?.key ?? null;

  useEffect(() => {
    if (!key) return;
    let live = true;
    loadStarred().then((s) => live && setOn(s.keys.has(key)));
    const changed = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; on: boolean }>).detail;
      if (d?.key === key) setOn(d.on);
    };
    window.addEventListener(STARRED_MEALS_CHANGED, changed);
    return () => {
      live = false;
      window.removeEventListener(STARRED_MEALS_CHANGED, changed);
    };
  }, [key]);

  if (!star) return null;

  async function toggle(e: React.MouseEvent) {
    // Inside a planner option (a label that ticks the option): starring never ticks or unticks it.
    e.preventDefault();
    e.stopPropagation();
    if (!star || busy || on === null) return;
    const s = await loadStarred();
    if (!s.userId) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const next = !on;
    const ok = next
      ? await saved(supabase.from("recipe_favorites").insert(starInsertRow(s.userId, star)), "Couldn't star that meal. Try again.")
      : await saved(supabase.from("recipe_favorites").delete().eq("profile_id", s.userId).eq("kind", "meal").eq("recipe_id", star.key), "Couldn't take that meal off your favorites. Try again.");
    setBusy(false);
    if (!ok) return;
    if (next) s.keys.add(star.key);
    else s.keys.delete(star.key);
    window.dispatchEvent(new CustomEvent(STARRED_MEALS_CHANGED, { detail: { key: star.key, on: next } }));
    onChange?.(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-disabled={busy || on === null}
      aria-pressed={!!on}
      aria-label={on ? `Remove ${star.name} from favorite meals` : `Star ${star.name} as a favorite meal`}
      className="w-11 h-11 shrink-0 flex items-center justify-center aria-disabled:opacity-60"
      data-star-meal={star.key}
    >
      <Star className={`w-5 h-5 ${on ? "text-amber fill-amber" : "text-steel"}`} />
    </button>
  );
}
