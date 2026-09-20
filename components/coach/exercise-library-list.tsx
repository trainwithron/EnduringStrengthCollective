"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { ExerciseMediaPicker } from "./exercise-media-picker";
import { AutoCategorizeButton } from "./auto-categorize-button";
import { classifyExerciseCategory } from "@/lib/exercise-category-classifier";
import { classifyEquipmentType, type EquipmentType } from "@/lib/equipment-classifier";
import { BiomechTagPicker, type BiomechTagOption, type BiomechTagSelection } from "./biomech-tag-picker";
import { generateBiomechBreakdown } from "@/lib/biomech-breakdown";
import { ExerciseQrCodeButton } from "./exercise-qr-code-button";
import { Trash2, Trophy } from "lucide-react";

export interface LibraryExerciseRow {
  id: string;
  name: string;
  videoPath: string | null;
  youtubeUrl: string | null;
  tier: "A" | "B" | "C" | null;
  category: string | null;
  equipmentType: EquipmentType | null;
  description: string | null;
}

// Locked seven-value set (Movement Pattern Ladders seed, 2026-09-14) —
// feeds the program-card visual split bar (lib/program-card-visuals.ts's
// bucketCategorySplit), so this list and that bucketing logic must stay
// in sync.
const CATEGORIES = ["Push", "Pull", "Legs", "Core", "Cardio/Mobility", "Plyometric/Sprint", "Other/Custom"] as const;
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
  groupId,
  coachId,
  initialExercises,
  biomechVocabulary,
  initialBiomechTagsByExercise,
}: {
  groupId: string;
  coachId: string;
  initialExercises: LibraryExerciseRow[];
  biomechVocabulary: BiomechTagOption[];
  // Keyed by exercise name (the tagging layer's real join key), not id —
  // shared across every coach's own copy of the same-named exercise.
  initialBiomechTagsByExercise: Record<string, BiomechTagSelection[]>;
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
  // The "required for new exercises going forward" rule
  // (corrective_exercise_biomechanical_tagging_idea.md) — held locally
  // until the exercise is actually created, since there's no row/id to
  // attach tags to yet. Existing exercises (256 of them, predating this
  // feature) are never blocked by this — only a brand-new one.
  const [newTags, setNewTags] = useState<BiomechTagSelection[]>([]);
  const [tagsByExercise, setTagsByExercise] =
    useState<Record<string, BiomechTagSelection[]>>(initialBiomechTagsByExercise);

  // AI-assisted suggest-and-confirm classifier
  // (biomech_redundancy_tagging_backfill_scoping_sept19.md) — a real LLM
  // call per exercise name, never auto-written. For an existing exercise
  // the result sits here as chips the coach clicks to accept one at a
  // time (or "Accept all"), each accept going through the exact same
  // toggleExistingTag/setExistingTagRole write path a manual click would.
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<
    Record<string, { tagId: string; role: BiomechTagSelection["role"]; label: string }[]>
  >({});

  function toggleNewTag(tagId: string) {
    setNewTags((prev) =>
      prev.some((t) => t.tagId === tagId)
        ? prev.filter((t) => t.tagId !== tagId)
        : [...prev, { tagId, role: "prime_mover" }]
    );
  }
  function setNewTagRole(tagId: string, role: BiomechTagSelection["role"]) {
    setNewTags((prev) => prev.map((t) => (t.tagId === tagId ? { ...t, role } : t)));
  }

  async function toggleExistingTag(exerciseName: string, tagId: string) {
    const current = tagsByExercise[exerciseName] ?? [];
    const already = current.some((t) => t.tagId === tagId);
    const supabase = createBrowserClient();
    if (already) {
      setTagsByExercise((prev) => ({
        ...prev,
        [exerciseName]: (prev[exerciseName] ?? []).filter((t) => t.tagId !== tagId),
      }));
      await supabase
        .from("exercise_biomech_tags")
        .delete()
        .eq("exercise_name", exerciseName)
        .eq("tag_id", tagId);
    } else {
      setTagsByExercise((prev) => ({
        ...prev,
        [exerciseName]: [...(prev[exerciseName] ?? []), { tagId, role: "prime_mover" }],
      }));
      await supabase
        .from("exercise_biomech_tags")
        .upsert(
          { exercise_name: exerciseName, tag_id: tagId, role: "prime_mover", created_by: coachId },
          { onConflict: "exercise_name,tag_id", ignoreDuplicates: true }
        );
    }
  }

  async function setExistingTagRole(exerciseName: string, tagId: string, role: BiomechTagSelection["role"]) {
    setTagsByExercise((prev) => ({
      ...prev,
      [exerciseName]: (prev[exerciseName] ?? []).map((t) => (t.tagId === tagId ? { ...t, role } : t)),
    }));
    const supabase = createBrowserClient();
    await supabase
      .from("exercise_biomech_tags")
      .update({ role })
      .eq("exercise_name", exerciseName)
      .eq("tag_id", tagId);
  }

  async function handleSuggestTags(exerciseName: string, target: "new" | string) {
    if (!exerciseName.trim()) return;
    setSuggestingKey(target);
    setSuggestionError(null);
    try {
      const res = await fetch("/api/biomech-tags/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSuggestionError(data.error ?? "Couldn't get suggestions — try again.");
        return;
      }
      const suggestions: { tagId: string; role: BiomechTagSelection["role"]; label: string }[] =
        data.suggestions ?? [];
      if (target === "new") {
        setNewTags(suggestions.map((s) => ({ tagId: s.tagId, role: s.role })));
      } else {
        const already = new Set((tagsByExercise[target] ?? []).map((t) => t.tagId));
        setPendingSuggestions((prev) => ({
          ...prev,
          [target]: suggestions.filter((s) => !already.has(s.tagId)),
        }));
      }
    } catch {
      setSuggestionError("Couldn't reach the AI — try again.");
    } finally {
      setSuggestingKey(null);
    }
  }

  async function acceptSuggestedTag(exerciseName: string, tagId: string, role: BiomechTagSelection["role"]) {
    await toggleExistingTag(exerciseName, tagId);
    if (role !== "prime_mover") await setExistingTagRole(exerciseName, tagId, role);
    setPendingSuggestions((prev) => ({
      ...prev,
      [exerciseName]: (prev[exerciseName] ?? []).filter((s) => s.tagId !== tagId),
    }));
  }

  async function acceptAllSuggestedTags(exerciseName: string) {
    for (const s of pendingSuggestions[exerciseName] ?? []) {
      await acceptSuggestedTag(exerciseName, s.tagId, s.role);
    }
  }

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
    // Required for new exercises going forward — an app-layer rule, not
    // a DB constraint (tags key off the name string, not a FK from
    // exercise_library, so there's nothing to make NOT NULL without
    // breaking the 256 exercises that predate this feature).
    if (!trimmed || newTags.length === 0) return;
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
      .select("id, name, video_path, youtube_url, category, equipment_type, description")
      .single();

    if (data) {
      // Independent of the exercise_library row above — tags key off
      // the name, not the new row's id, so this can run regardless of
      // whether another coach already tagged the same exercise name.
      // Upsert with ignoreDuplicates rather than a plain insert, so that
      // coincidence (two coaches independently creating the same new
      // exercise name) can't surface as a write error here.
      await supabase.from("exercise_biomech_tags").upsert(
        newTags.map((t) => ({
          exercise_name: trimmed,
          tag_id: t.tagId,
          role: t.role,
          created_by: coachId,
        })),
        { onConflict: "exercise_name,tag_id", ignoreDuplicates: true }
      );

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
          description: data.description,
        },
      ]);
      setTagsByExercise((prev) => ({ ...prev, [data.name]: newTags }));
      setNewName("");
      setNewCategory("");
      setNewEquipmentType("");
      setNewTags([]);
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

  async function handleDescriptionChange(id: string, description: string) {
    const value = description.trim() || null;
    setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, description: value } : e)));
    const supabase = createBrowserClient();
    await supabase.from("exercise_library").update({ description: value }).eq("id", id);
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
          disabled={submitting || !newName.trim() || newTags.length === 0}
          title={newTags.length === 0 ? "Add at least one biomechanical tag below first" : undefined}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {newName.trim() && (
        <div className="mb-6 max-w-3xl">
          <div className="flex items-center justify-between mb-1">
            <p className="font-body text-xs text-steel uppercase tracking-wide">
              Biomechanical tags — required for a new exercise
            </p>
            <button
              type="button"
              onClick={() => handleSuggestTags(newName, "new")}
              disabled={suggestingKey === "new"}
              className="font-body text-[11px] text-rust uppercase tracking-wide disabled:opacity-40"
            >
              {suggestingKey === "new" ? "Asking AI…" : "✨ Suggest tags (AI)"}
            </button>
          </div>
          <p className="font-body text-[11px] text-steel mb-2">
            {newTags.length === 0
              ? "Hidden from clients, used for corrective-exercise selection."
              : generateBiomechBreakdown(
                  newTags.map((t) => ({
                    ...biomechVocabulary.find((v) => v.id === t.tagId)!,
                    role: t.role,
                  }))
                ).summary}
          </p>
          {suggestionError && <p className="font-body text-[11px] text-rust mb-2">{suggestionError}</p>}
          <BiomechTagPicker
            vocabulary={biomechVocabulary}
            selected={newTags}
            onToggle={toggleNewTag}
            onRoleChange={setNewTagRole}
          />
        </div>
      )}

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
                {group.items.map((ex) => {
                  const exTags = tagsByExercise[ex.name] ?? [];
                  const breakdown =
                    exTags.length > 0
                      ? generateBiomechBreakdown(
                          exTags.map((t) => ({
                            ...biomechVocabulary.find((v) => v.id === t.tagId)!,
                            role: t.role,
                          }))
                        )
                      : null;
                  return (
                  <div key={ex.id} className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="font-body font-medium text-[15px]">{ex.name}</span>
                        {ex.description && (
                          <p className="font-body text-[11px] text-steel truncate">{ex.description}</p>
                        )}
                        {breakdown && (
                          <p className="font-body text-[11px] text-steel truncate">{breakdown.summary}</p>
                        )}
                      </div>
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
                      <Link
                        href={`/groups/${groupId}/games/${ex.id}`}
                        aria-label={`Leaderboard for ${ex.name}`}
                        className="w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
                      >
                        <Trophy className="w-4 h-4" />
                      </Link>
                      <ExerciseQrCodeButton exerciseId={ex.id} exerciseName={ex.name} />
                      <button
                        type="button"
                        onClick={() => setExpandedId((prev) => (prev === ex.id ? null : ex.id))}
                        className="font-body text-xs text-rust"
                      >
                        {expandedId === ex.id ? "Close" : "Edit"}
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
                      <div className="mt-3 max-w-2xl space-y-4">
                        <div>
                          <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
                            Description / instructions
                          </p>
                          <textarea
                            defaultValue={ex.description ?? ""}
                            onBlur={(e) => handleDescriptionChange(ex.id, e.target.value)}
                            placeholder="How it's done, rules, setup — shown to any coach browsing this exercise."
                            rows={3}
                            className="w-full bg-surface border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust"
                          />
                        </div>
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
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-body text-xs text-steel uppercase tracking-wide">
                              Biomechanical tags
                            </p>
                            <button
                              type="button"
                              onClick={() => handleSuggestTags(ex.name, ex.name)}
                              disabled={suggestingKey === ex.name}
                              className="font-body text-[11px] text-rust uppercase tracking-wide disabled:opacity-40"
                            >
                              {suggestingKey === ex.name ? "Asking AI…" : "✨ Suggest tags (AI)"}
                            </button>
                          </div>
                          <p className="font-body text-[11px] text-steel mb-2">
                            {breakdown?.summary ?? "No biomechanical tags added yet."}
                          </p>
                          {suggestionError && (
                            <p className="font-body text-[11px] text-rust mb-2">{suggestionError}</p>
                          )}
                          {(pendingSuggestions[ex.name]?.length ?? 0) > 0 && (
                            <div className="border border-rust/30 bg-rust/5 px-3 py-2 mb-2">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="font-body text-[11px] text-steel">
                                  AI suggests — click to accept, or ignore:
                                </p>
                                <button
                                  type="button"
                                  onClick={() => acceptAllSuggestedTags(ex.name)}
                                  className="font-body text-[11px] text-rust uppercase tracking-wide font-bold"
                                >
                                  Accept all
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {pendingSuggestions[ex.name]!.map((s) => (
                                  <button
                                    key={s.tagId}
                                    type="button"
                                    onClick={() => acceptSuggestedTag(ex.name, s.tagId, s.role)}
                                    className="h-6 px-2 border border-steel/30 text-chalk font-body text-[11px] active:border-rust active:text-rust"
                                  >
                                    {s.label} · {s.role === "prime_mover" ? "Prime mover" : "Stabilizer"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <BiomechTagPicker
                            vocabulary={biomechVocabulary}
                            selected={exTags}
                            onToggle={(tagId) => toggleExistingTag(ex.name, tagId)}
                            onRoleChange={(tagId, role) => setExistingTagRole(ex.name, tagId, role)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
