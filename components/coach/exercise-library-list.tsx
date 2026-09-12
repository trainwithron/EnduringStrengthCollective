"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { ExerciseMediaPicker } from "./exercise-media-picker";
import { AutoCategorizeButton } from "./auto-categorize-button";
import { classifyExerciseCategory } from "@/lib/exercise-category-classifier";
import { classifyEquipmentType, type EquipmentType } from "@/lib/equipment-classifier";
import { Trash2 } from "lucide-react";

export interface LibraryExerciseRow {
  id: string;
  name: string;
  videoPath: string | null;
  youtubeUrl: string | null;
  tier: "A" | "B" | "C" | null;
  category: string | null;
  equipmentType: EquipmentType | null;
}

const CATEGORIES = ["Push", "Pull", "Legs", "Core", "Full Body", "Cardio", "Mobility"] as const;
const CATEGORY_ORDER = [...CATEGORIES, "Uncategorized"];

// Labels, not raw enum values — shown in the Exercise Library's per-row
// select. Powers Phase 3 of the gamified-logging thread
// (custom_shape_theming_idea.md): the per-set visual during logging
// follows what equipment an exercise actually uses.
const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "kettlebell", label: "Kettlebell" },
  { value: "machine", label: "Machine" },
  { value: "cable", label: "Cable" },
  { value: "band", label: "Band" },
  { value: "bodyweight", label: "Bodyweight" },
];

export function ExerciseLibraryList({
  coachId,
  initialExercises,
}: {
  coachId: string;
  initialExercises: LibraryExerciseRow[];
}) {
  const [exercises, setExercises] = useState(initialExercises);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");
  const [newEquipmentType, setNewEquipmentType] = useState<string>("");
  // Tracks whether the category/equipment dropdowns are still following
  // the classifiers' live suggestion, or the coach has taken the wheel by
  // picking one themselves — a suggestion, never a silent auto-assign.
  const [categoryAutoSuggested, setCategoryAutoSuggested] = useState(true);
  const [equipmentAutoSuggested, setEquipmentAutoSuggested] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleNewNameChange(value: string) {
    setNewName(value);
    if (categoryAutoSuggested) {
      setNewCategory(classifyExerciseCategory(value) ?? "");
    }
    if (equipmentAutoSuggested) {
      setNewEquipmentType(classifyEquipmentType(value) ?? "");
    }
  }

  function handleNewCategoryChange(value: string) {
    setNewCategory(value);
    setCategoryAutoSuggested(false);
  }

  function handleNewEquipmentTypeChange(value: string) {
    setNewEquipmentType(value);
    setEquipmentAutoSuggested(false);
  }

  const visible = exercises
    .filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: visible.filter((e) => (e.category ?? "Uncategorized") === cat),
  })).filter((g) => g.items.length > 0);

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("exercise_library")
      .insert({
        created_by: coachId,
        name: trimmed,
        category: newCategory || null,
        equipment_type: newEquipmentType || null,
      })
      .select("id, name, video_path, youtube_url, category, equipment_type")
      .single();

    if (data) {
      setExercises((prev) => [
        ...prev,
        {
          id: data.id,
          name: data.name,
          videoPath: data.video_path,
          youtubeUrl: data.youtube_url,
          tier: null,
          category: data.category,
          equipmentType: data.equipment_type,
        },
      ]);
      setNewName("");
      setNewCategory("");
      setNewEquipmentType("");
      setCategoryAutoSuggested(true);
      setEquipmentAutoSuggested(true);
    }
    setSubmitting(false);
  }

  async function handleCategoryChange(id: string, category: string) {
    const value = category || null;
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, category: value } : e)));
    const supabase = createBrowserClient();
    await supabase.from("exercise_library").update({ category: value }).eq("id", id);
  }

  async function handleEquipmentTypeChange(id: string, equipmentType: string) {
    const value = (equipmentType || null) as EquipmentType | null;
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, equipmentType: value } : e)));
    const supabase = createBrowserClient();
    await supabase.from("exercise_library").update({ equipment_type: value }).eq("id", id);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this exercise from your library?")) return;
    setExercises((prev) => prev.filter((e) => e.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("exercise_library").delete().eq("id", id);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exercises…"
          className="h-10 w-64 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <div className="flex-1" />
        <AutoCategorizeButton exercises={exercises} onApplied={(id, category) => {
          setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, category } : e)));
        }} />
        <select
          value={newCategory}
          onChange={(e) => handleNewCategoryChange(e.target.value)}
          aria-label={
            categoryAutoSuggested && newCategory
              ? `Category, suggested ${newCategory} — change to override`
              : "Category"
          }
          className={`h-10 bg-surface border text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust ${
            categoryAutoSuggested && newCategory ? "border-rust/50" : "border-steel/30"
          }`}
        >
          <option value="">No category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={newEquipmentType}
          onChange={(e) => handleNewEquipmentTypeChange(e.target.value)}
          aria-label={
            equipmentAutoSuggested && newEquipmentType
              ? `Equipment, suggested ${newEquipmentType} — change to override`
              : "Equipment"
          }
          className={`h-10 bg-surface border text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust ${
            equipmentAutoSuggested && newEquipmentType ? "border-rust/50" : "border-steel/30"
          }`}
        >
          <option value="">No equipment</option>
          {EQUIPMENT_TYPES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={newName}
          onChange={(e) => handleNewNameChange(e.target.value)}
          placeholder="New exercise name"
          className="h-10 w-56 bg-surface border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">No exercises match.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.category}>
              <h3 className="font-display uppercase text-xs tracking-wide text-steel mb-2">
                {group.category}
              </h3>
              <div className="divide-y divide-steel/15">
                {group.items.map((ex) => (
                  <div key={ex.id} className="py-3">
                    <div className="flex items-center gap-3">
                      <span className="font-body font-medium text-[15px] flex-1">{ex.name}</span>
                      {ex.tier && (
                        <span className="h-6 w-6 flex items-center justify-center border border-steel/30 font-body text-[11px] text-steel">
                          {ex.tier}
                        </span>
                      )}
                      {(ex.videoPath || ex.youtubeUrl) && (
                        <span className="font-body text-[11px] text-positive">Media attached</span>
                      )}
                      <select
                        value={ex.category ?? ""}
                        onChange={(e) => handleCategoryChange(ex.id, e.target.value)}
                        className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                      >
                        <option value="">No category</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <select
                        value={ex.equipmentType ?? ""}
                        onChange={(e) => handleEquipmentTypeChange(ex.id, e.target.value)}
                        aria-label={`Equipment for ${ex.name}`}
                        className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
                      >
                        <option value="">No equipment</option>
                        {EQUIPMENT_TYPES.map((e) => (
                          <option key={e.value} value={e.value}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setExpandedId((prev) => (prev === ex.id ? null : ex.id))}
                        className="font-body text-xs text-rust"
                      >
                        {expandedId === ex.id ? "Close" : "Edit media"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(ex.id)}
                        aria-label={`Delete ${ex.name}`}
                        className="w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {expandedId === ex.id && (
                      <div className="mt-3 max-w-md">
                        <ExerciseMediaPicker
                          exerciseName={ex.name}
                          videoPath={ex.videoPath}
                          youtubeUrl={ex.youtubeUrl}
                          onChange={(patch) =>
                            setExercises((prev) =>
                              prev.map((e) => (e.id === ex.id ? { ...e, ...patch } : e))
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
