"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { saved } from "@/lib/saved";
import { initialsOf } from "@/lib/initials";
import { SUGGESTED_CONGRATS } from "@/lib/coach-congrats";

// coach_identity_bio_social_link_pinning_scoping_sept19.md — the coach-
// facing edit entry point (placed at the top of the coach home
// dashboard, per Ron's own "whatever, something like that" on exact
// placement). A full profile photo, deliberately separate from the
// small avatar_url already used everywhere else in the app.
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Look Refresh (Ron, Nov 20): on Home the profile strip folds into the greeting band at the top: the coach's photo (tap to edit the profile), the date, the
// greeting, a one-line summary of the day, how many clients trained this week, and the two things a coach starts most. Without `band` it is the plain strip.
export interface HomeBand {
  dateLabel: string;
  title: string;
  summary: string;
  ring?: React.ReactNode;
  actions?: React.ReactNode;
}

export function CoachProfileEditor({
  coachId,
  coachName,
  initialBio,
  initialPhotoUrl,
  initialCompletionMessage = null,
  band,
}: {
  coachId: string;
  coachName: string;
  initialBio: string | null;
  initialPhotoUrl: string | null;
  initialCompletionMessage?: string | null;
  band?: HomeBand;
}) {
  const [bio, setBio] = useState(initialBio ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [completionMessage, setCompletionMessage] = useState(initialCompletionMessage ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function persist(patch: { bio?: string; photo_url?: string | null; completion_message?: string | null }) {
    const supabase = createBrowserClient();
    // Deliberately not checked here: the typed text stays in its box, leaving the box again saves it again, and the failure bar has already said when it did not save.
    await saved(supabase.from("coach_profiles").upsert({ coach_id: coachId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "coach_id" }));
  }

  async function handleBioBlur() {
    setSaving(true);
    await persist({ bio: bio.trim() });
    setSaving(false);
  }

  async function handleCompletionBlur() {
    setSaving(true);
    await persist({ completion_message: completionMessage.trim() || null });
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
      console.error("[profile photo upload]", uploadError.message);
      setError("Couldn't upload that image. Try again, or contact support if it keeps happening.");
      setUploading(false);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from("coach-profile-photos").getPublicUrl(path);
    setPhotoUrl(publicUrlData.publicUrl);
    await persist({ photo_url: publicUrlData.publicUrl });
    setUploading(false);
  }

  const form = expanded && (
    <div className="mt-4 space-y-3">
      <label className="flex items-center gap-2">
        <span className="h-9 px-3 rounded-row bg-graphite border border-steel/30 text-steel font-body text-xs cursor-pointer flex items-center">
          {uploading ? "Uploading…" : "Change photo"}
        </span>
        <input type="file" accept={ALLOWED_IMAGE_TYPES.join(",")} onChange={handlePhotoChange} disabled={uploading} className="hidden" />
      </label>
      <textarea aria-label="Short bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        onBlur={handleBioBlur}
        rows={3}
        placeholder="A short bio your clients will see when they tap your name…"
        className="w-full rounded-row bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
      />
      <label className="block">
        <span className="font-body text-xs text-steel block mb-1">
          Your message to a client after a workout. Clients see it as from you, so until you write one they see none. Use {"{name}"} for their first name.
        </span>
        <textarea
          value={completionMessage}
          onChange={(e) => setCompletionMessage(e.target.value.slice(0, 280))}
          onBlur={handleCompletionBlur}
          rows={2}
          placeholder={SUGGESTED_CONGRATS}
          className="w-full rounded-row bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-sm focus:outline-none focus:border-rust resize-none"
        />
      </label>
      {!completionMessage.trim() && (
        <button
          type="button"
          onClick={async () => {
            setCompletionMessage(SUGGESTED_CONGRATS);
            await persist({ completion_message: SUGGESTED_CONGRATS });
          }}
          className="min-h-11 font-body text-xs text-steel underline text-left"
        >
          Use the suggested line as mine
        </button>
      )}
      {saving && <p className="font-body text-xs text-steel">Saving…</p>}
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
      <p className="font-body text-xs text-steel">
        Add social links from Pro Shop (category: Social) — they show up in the same popup.
      </p>
    </div>
  );

  if (band) {
    return (
      <section className="home-band relative z-[1] p-5 sm:p-7 mb-6" aria-label="Today" data-home-band>
        <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-5">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Close your profile" : "Edit your profile: bio, photo, social links"}
              title="Edit your profile"
              className="home-band-avatar w-14 h-14 rounded-full shrink-0 overflow-hidden bg-rust text-graphite font-body font-semibold text-lg inline-flex items-center justify-center"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                initialsOf(coachName)
              )}
            </button>
            <div className="min-w-0">
              <p className="font-body text-[13px] text-steel">{band.dateLabel}</p>
              <h1 className="font-display font-semibold text-3xl sm:text-[34px] leading-tight text-chalk text-balance">{band.title}</h1>
              <p className="font-body text-sm text-steel mt-0.5">{band.summary}</p>
            </div>
          </div>
          {band.ring}
          {band.actions && <div className="flex flex-wrap items-center gap-2">{band.actions}</div>}
        </div>
        {expanded && <p className="font-body text-[13px] font-semibold text-chalk mt-5">Your public profile</p>}
        {form}
      </section>
    );
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

      {form}
    </div>
  );
}
