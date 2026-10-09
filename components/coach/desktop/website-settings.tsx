"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SITE_BACKGROUNDS, SITE_LIMITS, cleanSite, type SiteBackground, type SiteReview } from "@/lib/coach-site";

export interface WebsiteSettingsInitial {
  headline: string;
  whoIHelp: string;
  whatIDo: string;
  whyLines: string[];
  reviews: SiteReview[];
  background: SiteBackground;
  heroPath: string | null;
  coverPath: string | null;
  published: boolean;
}

const BUCKET = "coach-profile-photos";
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;
const input = "w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust";
const label = "font-body text-xs text-steel uppercase tracking-wide";

// The coach's one small "My website" screen: a few short fields, two pictures, a background choice, a Preview link and ONE Publish switch (off until the coach turns it on).
export function WebsiteSettings({ coachId, slug, initial }: { coachId: string; slug: string | null; initial: WebsiteSettingsInitial }) {
  const [headline, setHeadline] = useState(initial.headline);
  const [whoIHelp, setWhoIHelp] = useState(initial.whoIHelp);
  const [whatIDo, setWhatIDo] = useState(initial.whatIDo);
  const [why, setWhy] = useState<string[]>([0, 1, 2].map((i) => initial.whyLines[i] ?? ""));
  const [reviews, setReviews] = useState<SiteReview[]>([0, 1, 2].map((i) => initial.reviews[i] ?? { quote: "", first_name: "" }));
  const [background, setBackground] = useState<SiteBackground>(initial.background);
  const [heroPath, setHeroPath] = useState(initial.heroPath);
  const [coverPath, setCoverPath] = useState(initial.coverPath);
  const [published, setPublished] = useState(initial.published);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const supabase = createBrowserClient();
  const urlOf = (path: string | null) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

  async function save(next: { published?: boolean } = {}): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    const c = cleanSite({ headline, whoIHelp, whatIDo, whyLines: why, reviews, background });
    const { error } = await supabase.from("coach_sites").upsert(
      {
        coach_id: coachId,
        headline: c.headline || null,
        who_i_help: c.whoIHelp || null,
        what_i_do: c.whatIDo || null,
        why_lines: c.whyLines,
        reviews: c.reviews,
        background: c.background,
        hero_path: heroPath,
        cover_path: coverPath,
        published: next.published ?? published,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "coach_id" }
    );
    setBusy(false);
    if (error) {
      setMessage({ text: "That didn't save. Nothing was changed. Try again.", error: true });
      return false;
    }
    setMessage({ text: "Saved.", error: false });
    return true;
  }

  async function togglePublish() {
    const next = !published;
    if (next && !slug) {
      setMessage({ text: "Turn on your booking page first: your website uses its address.", error: true });
      return;
    }
    if (await save({ published: next })) setPublished(next);
  }

  async function upload(kind: "hero" | "cover", file: File | undefined) {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setMessage({ text: "Use a PNG, JPG, or WebP image.", error: true });
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage({ text: "Image must be under 5MB.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${coachId}/site-${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    setBusy(false);
    if (error) {
      console.error("[website image upload]", error.message);
      setMessage({ text: "Couldn't upload that image. Try again, or contact support if it keeps happening.", error: true });
      return;
    }
    if (kind === "hero") setHeroPath(path);
    else setCoverPath(path);
  }

  const heroUrl = urlOf(heroPath);
  const coverUrl = urlOf(coverPath);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3 border border-steel/20 p-4">
        <label className="flex items-center gap-3 min-h-11 font-body text-sm text-chalk cursor-pointer">
          <input type="checkbox" checked={published} onChange={togglePublish} disabled={busy} className="w-5 h-5 accent-[#D2703B]" />
          Publish my website
        </label>
        {slug ? (
          <>
            <a href={`/c/${slug}?preview=1`} target="_blank" rel="noopener" className="inline-flex items-center min-h-11 font-body text-sm text-rust underline">
              Preview
            </a>
            {published && (
              <a href={`/c/${slug}`} target="_blank" rel="noopener" className="inline-flex items-center min-h-11 font-body text-sm text-steel underline">
                Open the public page
              </a>
            )}
          </>
        ) : (
          <p className="font-body text-xs text-steel">Your website uses your booking page address. Turn on your booking page to get one.</p>
        )}
      </div>

      <label className="block">
        <span className={label}>Headline</span>
        <input value={headline} maxLength={SITE_LIMITS.headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Strength and mobility specialist" className={`${input} mt-1`} />
      </label>

      <div className="space-y-3">
        <p className={label}>About me</p>
        <label className="block">
          <span className="font-body text-xs text-steel">Who you help</span>
          <textarea value={whoIHelp} maxLength={SITE_LIMITS.whoIHelp} rows={2} onChange={(e) => setWhoIHelp(e.target.value)} className="mt-1 w-full bg-graphite border border-steel/30 text-chalk p-3 font-body text-sm focus:outline-none focus:border-rust" />
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel">What you do</span>
          <textarea value={whatIDo} maxLength={SITE_LIMITS.whatIDo} rows={3} onChange={(e) => setWhatIDo(e.target.value)} className="mt-1 w-full bg-graphite border border-steel/30 text-chalk p-3 font-body text-sm focus:outline-none focus:border-rust" />
        </label>
      </div>

      <div className="space-y-2">
        <p className={label}>Why pick me (up to 3 short lines)</p>
        {why.map((line, i) => (
          <input key={i} value={line} maxLength={SITE_LIMITS.whyLineLength} onChange={(e) => setWhy((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Why pick me, line ${i + 1}`} className={input} />
        ))}
      </div>

      <div className="space-y-3">
        <p className={label}>Client reviews (up to 3)</p>
        <p className="font-body text-xs text-steel">Only add a review a client has agreed to. Short quotes, with a first name.</p>
        {reviews.map((r, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-2">
            <input value={r.quote} maxLength={SITE_LIMITS.quote} onChange={(e) => setReviews((prev) => prev.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} placeholder="Quote" aria-label={`Review ${i + 1} quote`} className={input} />
            <input value={r.first_name} maxLength={SITE_LIMITS.firstName} onChange={(e) => setReviews((prev) => prev.map((x, j) => (j === i ? { ...x, first_name: e.target.value } : x)))} placeholder="First name" aria-label={`Review ${i + 1} first name`} className={input} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(["hero", "cover"] as const).map((kind) => {
          const url = kind === "hero" ? heroUrl : coverUrl;
          return (
            <div key={kind}>
              <p className={label}>{kind === "hero" ? "Your photo" : "Cover photo"}</p>
              {url && (
                // eslint-disable-next-line @next/next/no-img-element -- public Supabase Storage URL.
                <img src={url} alt="" className={`mt-2 object-cover border border-steel/20 ${kind === "hero" ? "w-24 h-24 rounded-full" : "w-full h-24"}`} />
              )}
              <label className="mt-2 inline-flex items-center h-11 px-4 border border-steel/40 text-chalk font-body text-sm cursor-pointer focus-within:border-rust">
                {url ? "Change" : "Upload"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => upload(kind, e.target.files?.[0])} />
              </label>
              {url && (
                <button type="button" onClick={() => (kind === "hero" ? setHeroPath(null) : setCoverPath(null))} className="ml-2 h-11 px-3 font-body text-sm text-steel">
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <p className={label}>Background</p>
        <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Background">
          {SITE_BACKGROUNDS.map((b) => (
            <button key={b.value} type="button" aria-pressed={background === b.value} onClick={() => setBackground(b.value)} className={`h-11 px-4 font-body text-sm border ${background === b.value ? "bg-rust/15 text-rust border-rust/50" : "text-steel border-steel/30"}`}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="h-11 px-6 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
        {message && (
          <p className={`font-body text-sm ${message.error ? "text-rust" : "text-positive"}`} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
