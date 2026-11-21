"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { photoProblem, uploadProgressPhoto } from "@/lib/progress-photo-upload";

interface PhotoRow {
  id: string;
  storagePath: string;
  takenDate: string;
  sharedWithCoach: boolean;
  signedUrl: string | null;
}

// Transformation Cards' one hard dependency — a real, persistent, private
// photo journal. Private by default: nothing here is ever visible to the
// coach unless the athlete explicitly flips "Share with coach" on a
// specific photo. Deliberately reachable only from the athlete's own
// Settings, and deliberately NOT wired into View-as-Client — a coach
// standing in for a client shouldn't be the one uploading (or even
// browsing) someone else's progress photos, unlike form-check videos.
export function ProgressPhotoJournal({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPhotos() {
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from("progress_photos")
      .select("id, storage_path, taken_date, shared_with_coach")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("taken_date", { ascending: false });

    const rows = data ?? [];
    const withUrls = await Promise.all(
      rows.map(async (r) => {
        const { data: signed } = await supabase.storage
          .from("progress-photos")
          .createSignedUrl(r.storage_path, 3600);
        return {
          id: r.id,
          storagePath: r.storage_path,
          takenDate: r.taken_date,
          sharedWithCoach: r.shared_with_coach,
          signedUrl: signed?.signedUrl ?? null,
        };
      })
    );
    setPhotos(withUrls);
    setLoading(false);
  }

  useEffect(() => {
    loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, groupId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const problem = photoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }

    setUploading(true);
    setError(null);
    // Private by default: the journal's own photos are never shared until the client flips "Share with coach".
    const result = await uploadProgressPhoto(createBrowserClient(), { athleteId, groupId, file, sharedWithCoach: false });
    if (!result.ok) {
      setError(result.error);
      setUploading(false);
      return;
    }

    await loadPhotos();
    setUploading(false);
  }

  async function handleToggleShare(photo: PhotoRow) {
    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, sharedWithCoach: !p.sharedWithCoach } : p))
    );
    const supabase = createBrowserClient();
    const ok = await saved(supabase
      .from("progress_photos")
      .update({ shared_with_coach: !photo.sharedWithCoach })
      .eq("id", photo.id));
    // A failed save puts the box back: this setting is privacy, and the screen must show what is really stored.
    if (!ok) setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, sharedWithCoach: photo.sharedWithCoach } : p)));
  }

  async function handleDelete(photo: PhotoRow) {
    if (!await confirmDialog("Delete this photo? This can't be undone.")) return;
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    const supabase = createBrowserClient();
    // The file goes only after the row is gone: a failed row delete leaves the photo and its file both in place (and the card comes back).
    if (!(await saved(supabase.from("progress_photos").delete().eq("id", photo.id)))) {
      await loadPhotos();
      return;
    }
    await supabase.storage.from("progress-photos").remove([photo.storagePath]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display font-bold text-2xl uppercase leading-none">Progress Photos</h1>
          <p className="font-body text-xs text-steel mt-2">
            Private by default. Nothing here is ever visible to your coach unless you choose to share
            a specific photo.
          </p>
        </div>
        <label className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium flex items-center cursor-pointer disabled:opacity-40">
          {uploading ? "Uploading…" : "+ Add photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {error && (
        <p className="font-body text-xs text-rust-ink mb-3" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body text-sm text-steel">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">
          No photos yet — add your first one to start tracking your own progress, just for you.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="border border-steel/20 bg-surface/40 rounded-token-lg overflow-hidden">
              {photo.signedUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.signedUrl} alt="" className="w-full aspect-square object-cover" />
              )}
              <div className="p-2">
                <p className="font-body text-xs text-steel">
                  {new Date(`${photo.takenDate}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                {/* 44px rows to tap (audit C19, Nov 21). */}
                <label className="flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
                  <input
                    type="checkbox"
                    checked={photo.sharedWithCoach}
                    onChange={() => handleToggleShare(photo)}
                    className="w-5 h-5"
                  />
                  Share with coach
                </label>
                <button
                  type="button"
                  onClick={() => handleDelete(photo)}
                  className="min-h-11 inline-flex items-center font-body text-xs text-steel active:text-rust-ink transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
