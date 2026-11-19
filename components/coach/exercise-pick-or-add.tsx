"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { existingLibraryName } from "@/lib/exercise-search";
import { addLibraryExercise } from "@/lib/library-write";
import { classifyExerciseCategory } from "@/lib/exercise-category-classifier";
import { classifyEquipmentType, type EquipmentType } from "@/lib/equipment-classifier";
import type { LibraryExerciseRow } from "./exercise-library-list";

// Pick an exercise from the coach's library by typing, or add the typed name as a new exercise right there. One piece for "Add exercise demo" and for a machine's exercises
// (components/coach/gym-machines-panel.tsx). A new exercise needs only its name here: its category and equipment are guessed, tags can be added later from the list.
export function ExercisePickOrAdd({
  coachId,
  exercises,
  onPick,
  onExerciseAdded,
  placeholder = "Which exercise? Type to search or add",
  excludeIds,
  demoFirst = false,
}: {
  coachId: string;
  exercises: LibraryExerciseRow[];
  onPick: (row: LibraryExerciseRow) => void;
  onExerciseAdded: (row: LibraryExerciseRow) => void;
  placeholder?: string;
  // Exercises not to offer (already on the machine).
  excludeIds?: Set<string>;
  // Exercises without a demo first (Add exercise demo); otherwise by name.
  demoFirst?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const hasDemo = (e: LibraryExerciseRow) => Number(!!(e.videoPath || e.youtubeUrl));
  const matches = q
    ? exercises
        .filter((e) => e.name.toLowerCase().includes(q) && !excludeIds?.has(e.id))
        .sort((a, b) => (demoFirst ? hasDemo(a) - hasDemo(b) : 0) || a.name.localeCompare(b.name))
        .slice(0, 8)
    : [];
  const exact = q ? existingLibraryName(query.trim(), exercises.map((e) => e.name)) : null;

  function pick(row: LibraryExerciseRow) {
    setQuery("");
    setError(null);
    onPick(row);
  }

  async function addNew() {
    const name = query.trim();
    setAdding(true);
    setError(null);
    const supabase = createBrowserClient();
    const added = await addLibraryExercise(supabase, {
      userId: coachId,
      name,
      existingNames: exercises.map((e) => e.name),
      fields: { category: classifyExerciseCategory(name), equipment_type: classifyEquipmentType(name) },
      select: "id, name, video_path, youtube_url, category, equipment_type, description",
    });
    setAdding(false);
    if (!added.ok) return setError(added.error);
    if (added.alreadyThere) {
      const there = exercises.find((e) => e.name === added.name);
      if (there) pick(there);
      return;
    }
    const r = added.row as { id: string; name: string; video_path: string | null; youtube_url: string | null; category: string | null; equipment_type: EquipmentType | null; description: string | null } | null;
    if (!r) return setError("Couldn't add that to your library. Try again.");
    const row: LibraryExerciseRow = { id: r.id, name: r.name, videoPath: r.video_path, youtubeUrl: r.youtube_url, tier: null, category: r.category, equipmentType: r.equipment_type, description: r.description };
    onExerciseAdded(row);
    pick(row);
  }

  return (
    <div className="space-y-3">
      <input
        aria-label="Which exercise"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        placeholder={placeholder}
        autoFocus
        className="w-full h-12 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base focus:outline-none focus:border-rust"
      />
      {matches.length > 0 && (
        <ul className="divide-y divide-steel/15 border border-steel/20">
          {matches.map((ex) => (
            <li key={ex.id}>
              <button type="button" onClick={() => pick(ex)} className="w-full min-h-12 px-3 flex items-center justify-between gap-3 text-left">
                <span className="font-body text-sm text-chalk">{ex.name}</span>
                {ex.videoPath || ex.youtubeUrl ? (
                  <span className="font-body text-xs text-steel shrink-0">Has a demo</span>
                ) : (
                  <span className="font-body text-xs text-amber-400 shrink-0">No demo yet</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {exact && excludeIds && matches.length === 0 && exercises.some((e) => e.name === exact && excludeIds.has(e.id)) && (
        <p className="font-body text-xs text-steel">{exact} is already here.</p>
      )}
      {q && !exact && (
        <button
          type="button"
          onClick={() => void addNew()}
          disabled={adding}
          className="w-full min-h-12 px-3 border border-dashed border-rust/60 text-rust font-body text-sm text-left disabled:opacity-40"
        >
          {adding ? "Adding…" : `+ Add “${query.trim()}” as a new exercise`}
        </button>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
