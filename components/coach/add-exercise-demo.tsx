"use client";

import { useRef, useState } from "react";
import { Video } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { existingLibraryName } from "@/lib/exercise-search";
import { addLibraryExercise } from "@/lib/library-write";
import { classifyExerciseCategory } from "@/lib/exercise-category-classifier";
import { classifyEquipmentType, type EquipmentType } from "@/lib/equipment-classifier";
import { friendlyDbError } from "@/lib/exercise-name-guard";
import { demoContentType, demoExtension, uploadDemo } from "@/lib/exercise-demo-upload";
import { prepareDemo } from "@/lib/demo-convert";
import type { LibraryExerciseRow } from "./exercise-library-list";

// The big "Add exercise demo" button at the top of the library (Ron, Nov 12: "a very easily visible button to add an exercise demo to the existing library or create new exercises on
// the fly"). Pick an exercise or type a new one, then record or pick a video on the phone. A new exercise needs only its name here; tags can be added later from the list.
export function AddExerciseDemo({
  coachId,
  exercises,
  onExerciseAdded,
  onVideoSaved,
}: {
  coachId: string;
  exercises: LibraryExerciseRow[];
  onExerciseAdded: (row: LibraryExerciseRow) => void;
  onVideoSaved: (id: string, videoPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<LibraryExerciseRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // "Making it 1080p" (on the phone, before the upload) or "Uploading".
  const [stage, setStage] = useState<"convert" | "upload">("upload");
  const [mute, setMute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setQuery("");
    setChosen(null);
    setProgress(null);
    setError(null);
    setMute(false);
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? exercises
        .filter((e) => e.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!!(a.videoPath || a.youtubeUrl)) - Number(!!(b.videoPath || b.youtubeUrl)) || a.name.localeCompare(b.name))
        .slice(0, 8)
    : [];
  const exact = q ? existingLibraryName(query.trim(), exercises.map((e) => e.name)) : null;

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
      if (there) setChosen(there);
      return;
    }
    const r = added.row as { id: string; name: string; video_path: string | null; youtube_url: string | null; category: string | null; equipment_type: EquipmentType | null; description: string | null } | null;
    if (!r) return setError("Couldn't add that to your library. Try again.");
    const row: LibraryExerciseRow = { id: r.id, name: r.name, videoPath: r.video_path, youtubeUrl: r.youtube_url, tier: null, category: r.category, equipmentType: r.equipment_type, description: r.description };
    onExerciseAdded(row);
    setChosen(row);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked || !chosen) return;

    setError(null);
    setStage("convert");
    setProgress(0);
    const prepared = await prepareDemo(picked, { mute, onProgress: setProgress });
    if (!prepared.ok) {
      setProgress(null);
      return setError(prepared.error);
    }
    const file = prepared.file;
    const contentType = demoContentType(file)!;
    setStage("upload");
    setProgress(0);
    const supabase = createBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setProgress(null);
      return setError("You're signed out. Sign in again, then try.");
    }
    const path = `${coachId}/${crypto.randomUUID()}.${demoExtension(contentType)}`;
    const up = await uploadDemo({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      accessToken: token,
      path,
      file,
      contentType,
      onProgress: setProgress,
    });
    if (!up.ok) {
      setProgress(null);
      return setError(up.error);
    }
    const savedPath = up.path;
    const { error: dbError } = await supabase.from("exercise_library").update({ video_path: savedPath }).eq("id", chosen.id);
    if (dbError) {
      await supabase.storage.from("exercise-media").remove([savedPath]);
      setProgress(null);
      return setError(friendlyDbError(dbError.message));
    }
    // The old video (a replaced demo) is no longer used by anything.
    if (chosen.videoPath && chosen.videoPath !== savedPath) await supabase.storage.from("exercise-media").remove([chosen.videoPath]);
    onVideoSaved(chosen.id, savedPath);
    setDoneName(chosen.name);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button
          type="button"
          onClick={() => {
            setDoneName(null);
            setOpen(true);
          }}
          className="w-full h-14 bg-rust text-graphite font-body text-base font-medium flex items-center justify-center gap-2"
          data-add-exercise-demo
        >
          <Video className="w-5 h-5" aria-hidden />
          Add exercise demo
        </button>
        {doneName && (
          <p className="font-body text-sm text-positive mt-2" role="status">
            Demo added to {doneName}. Your clients see it now.
          </p>
        )}
      </div>
    );
  }

  const uploading = progress != null;
  return (
    <div className="mb-6 border border-rust/40 bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-display font-bold uppercase text-sm">Add exercise demo</p>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={uploading}
          className="min-h-11 px-2 font-body text-sm text-steel disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      {!chosen ? (
        <>
          <input
            aria-label="Which exercise"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="Which exercise? Type to search or add"
            autoFocus
            className="w-full h-12 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base focus:outline-none focus:border-rust"
          />
          {matches.length > 0 && (
            <ul className="divide-y divide-steel/15 border border-steel/20">
              {matches.map((ex) => (
                <li key={ex.id}>
                  <button type="button" onClick={() => setChosen(ex)} className="w-full min-h-12 px-3 flex items-center justify-between gap-3 text-left">
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
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="font-body text-sm text-chalk">
              <span className="text-steel">Exercise: </span>
              {chosen.name}
            </p>
            {!uploading && (
              <button type="button" onClick={() => setChosen(null)} className="min-h-11 px-2 font-body text-xs text-rust shrink-0">
                Change
              </button>
            )}
          </div>
          {(chosen.videoPath || chosen.youtubeUrl) && !uploading && (
            <p className="font-body text-xs text-steel">This exercise already has a demo. The new video replaces it.</p>
          )}
          {uploading ? (
            <div role="status" aria-live="polite">
              <div className="h-2 bg-graphite overflow-hidden">
                <div className="h-full bg-rust transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
              <p className="font-body text-xs text-steel mt-1">
                {stage === "convert" ? "Making it 1080p" : "Uploading"}… {Math.round((progress ?? 0) * 100)}%. Keep this page open.
              </p>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 min-h-11 font-body text-sm text-chalk">
                <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} className="w-5 h-5 accent-rust" />
                Mute this video
              </label>
              {/* No `capture`: the phone then offers both its camera and its gallery. */}
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full h-12 bg-rust text-graphite font-body text-sm font-medium flex items-center justify-center gap-2">
                <Video className="w-4 h-4" aria-hidden />
                Record or choose video
              </button>
              <input ref={fileRef} type="file" accept="video/*" onChange={(e) => void handleFile(e)} className="sr-only" aria-label="Demo video" tabIndex={-1} />
              <p className="font-body text-xs text-steel">Up to 30 seconds. 4K is fine: it is made 1080p on your phone first, so it uploads and plays faster.</p>
            </>
          )}
        </>
      )}

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
