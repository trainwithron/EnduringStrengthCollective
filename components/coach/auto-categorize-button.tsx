"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { classifyExerciseCategory, type ExerciseCategory } from "@/lib/exercise-category-classifier";
import type { LibraryExerciseRow } from "./exercise-library-list";

const CATEGORIES: ExerciseCategory[] = ["Push", "Pull", "Legs", "Core", "Full Body", "Cardio", "Mobility"];

// A one-time batch pass over every currently-uncategorized exercise —
// suggests a category for each via the keyword classifier, but writes
// nothing until the coach reviews and confirms. Every row is individually
// editable/skippable right up until "Apply" — this is a suggestion tool,
// never a silent bulk auto-assign.
export function AutoCategorizeButton({
  exercises,
  onApplied,
}: {
  exercises: LibraryExerciseRow[];
  onApplied: (id: string, category: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

  const uncategorized = exercises.filter((e) => !e.category);

  function handleOpen() {
    const seeded: Record<string, string> = {};
    for (const ex of uncategorized) {
      seeded[ex.id] = classifyExerciseCategory(ex.name) ?? "";
    }
    setDrafts(seeded);
    setOpen(true);
  }

  const suggestedCount = Object.values(drafts).filter((v) => v).length;

  async function handleApply() {
    setApplying(true);
    // Grouped by target category — one update per distinct category
    // value instead of one per exercise, same batched-write convention
    // used everywhere else in this app for bulk edits.
    const idsByCategory = new Map<string, string[]>();
    for (const [id, category] of Object.entries(drafts)) {
      if (!category) continue; // skipped — leave uncategorized
      const ids = idsByCategory.get(category) ?? [];
      ids.push(id);
      idsByCategory.set(category, ids);
    }

    const supabase = createBrowserClient();
    for (const [category, ids] of idsByCategory) {
      await supabase.from("exercise_library").update({ category }).in("id", ids);
      for (const id of ids) onApplied(id, category);
    }

    setApplying(false);
    setOpen(false);
  }

  if (open) {
    return (
      <div className="fixed inset-0 z-40 bg-graphite/95 flex items-center justify-center p-6">
        <div className="bg-surface border border-steel/30 w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div className="p-4 border-b border-steel/20">
            <h2 className="font-display uppercase text-lg tracking-wide">Auto-categorize</h2>
            <p className="font-body text-xs text-steel mt-1">
              {uncategorized.length} uncategorized {uncategorized.length === 1 ? "exercise" : "exercises"}
              {" — "}
              {suggestedCount} matched a suggestion. Review or change each one, then apply — nothing
              is saved until you do.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-steel/10">
            {uncategorized.length === 0 ? (
              <p className="font-body text-sm text-steel p-4">Nothing to categorize.</p>
            ) : (
              uncategorized.map((ex) => (
                <div key={ex.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="font-body text-sm flex-1">{ex.name}</span>
                  <select
                    value={drafts[ex.id] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [ex.id]: e.target.value }))}
                    aria-label={`Category for ${ex.name}`}
                    className="h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                  >
                    <option value="">Skip</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </div>

          <div className="p-4 border-t border-steel/20 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={applying}
              className="font-body text-sm text-steel disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || suggestedCount === 0}
              className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {applying ? "Applying…" : `Apply to ${suggestedCount}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={uncategorized.length === 0}
      className="h-10 px-3 border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
    >
      Auto-categorize{uncategorized.length > 0 ? ` (${uncategorized.length})` : ""}
    </button>
  );
}
