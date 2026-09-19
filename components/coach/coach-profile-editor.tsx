"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { initialsOf } from "@/lib/initials";

// coach_identity_bio_social_link_pinning_scoping_sept19.md — the coach-
// facing edit entry point (placed at the top of the coach home
// dashboard, per Ron's own "whatever, something like that" on exact
// placement). A full profile photo, deliberately separate from the
// small avatar_url already used everywhere else in the app.
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function CoachProfileEditor({
  coachId,
  coachName,
  initialBio,
  initialPhotoUrl,
}: {
  coachId: string;
  coachName: string;
  initialBio: string | null;
  initialPhotoUrl: string | null;
}) {
  const [bio, setBio] = useState(initialBio ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function persist(patch: { bio?: string; photo_url?: string | null }) {
    const supabase = createBrowserClient();
    await supabase.from("coach_profiles").upsert({ coach_id: coachId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "coach_id" });
  }

  async function handleBioBlur() {
    setSaving(true);
    await persist({ bio: bio.trim() });
    setSaving(false);
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }
    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${coachId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("coach-profile-photos").upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("coach-profile-photos").getPublicUrl(path);
    setPhotoUrl(publicUrlData.publicUrl);
    await persist({ photo_url: publicUrlData.publicUrl });
    setUploading(false);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-6">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center gap-3 text-left">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-steel/30 shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0">
            <span className="font-display text-sm">{initialsOf(coachName)}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm font-medium">{coachName}</p>
          <p className="font-body text-xs text-steel">
            {expanded ? "Editing your public profile" : "Edit your profile — bio, photo, social links"}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2">
            <span className="h-9 px-3 bg-graphite border border-steel/30 text-steel font-body text-xs cursor-pointer flex items-center">
              {uploading ? "Uploading…" : "Change photo"}
            </span>
            <input type="file" accept={ALLOWED_IMAGE_TYPES.join(",")} onChange={handlePhotoChange} disabled={uploading} className="hidden" />
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            onBlur={handleBioBlur}
            rows={3}
            placeholder="A short bio your clients will see when they tap your name…"
            className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
          />
          {saving && <p className="font-body text-[11px] text-steel">Saving…</p>}
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
          <p className="font-body text-[11px] text-steel">
            Add social links from Pro Shop (category: Social) — they show up in the same popup.
          </p>
        </div>
      )}
    </div>
  );
}
