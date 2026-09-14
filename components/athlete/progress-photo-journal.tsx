"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 15 * 1024 * 1024;

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

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use a JPEG, PNG, WebP, or HEIC photo.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Photo is too large — 15MB max.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${athleteId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("progress-photos").upload(path, file);
    if (uploadError) {
      setError("Couldn't upload — try again.");
      setUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from("progress_photos").insert({
      athlete_id: athleteId,
      group_id: groupId,
      storage_path: path,
      taken_date: new Date().toISOString().slice(0, 10),
    });
    if (insertError) {
      setError("Uploaded, but couldn't save it to your journal — try again.");
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
    await supabase
      .from("progress_photos")
      .update({ shared_with_coach: !photo.sharedWithCoach })
      .eq("id", photo.id);
  }

  async function handleDelete(photo: PhotoRow) {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    const supabase = createBrowserClient();
    await supabase.from("progress_photos").delete().eq("id", photo.id);
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
        <label className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium flex items-center cursor-pointer disabled:opacity-40">
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
        <p className="font-body text-xs text-rust mb-3" role="alert">
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
                <p className="font-body text-[11px] text-steel">
                  {new Date(`${photo.takenDate}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <label className="flex items-center gap-1.5 mt-1.5 font-body text-[11px] text-chalk">
                  <input
                    type="checkbox"
                    checked={photo.sharedWithCoach}
                    onChange={() => handleToggleShare(photo)}
                  />
                  Share with coach
                </label>
                <button
                  type="button"
                  onClick={() => handleDelete(photo)}
                  className="font-body text-[11px] text-steel active:text-rust transition-colors mt-1"
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
