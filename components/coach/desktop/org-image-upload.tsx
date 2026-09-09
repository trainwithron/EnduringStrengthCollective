"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 5 * 1024 * 1024;

// Shared upload widget for both branding images an org can set — the
// in-app "Logo" (any aspect ratio, shown in headers) and the PWA "App
// icon" (should be square, becomes the home-screen icon). Both write to
// the same public "org-branding" bucket at a fixed per-org filename
// (upsert: true) so re-uploading just replaces the old file instead of
// accumulating orphans, then persist the resulting public URL onto the
// matching `organizations` column.
export function OrgImageUpload({
  organizationId,
  column,
  label,
  helpText,
  initialUrl,
  previewClassName,
}: {
  organizationId: string;
  column: "logo_url" | "app_icon_url";
  label: string;
  helpText: string;
  initialUrl: string | null;
  previewClassName: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, WebP, or SVG image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();

    const ext = file.name.split(".").pop() || "png";
    const kind = column === "logo_url" ? "logo" : "icon";
    const path = `${organizationId}/${kind}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("org-branding")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from("org-branding").getPublicUrl(path);
    // Cache-bust: the filename never changes on re-upload, so append a
    // fresh query param or every viewer's browser (and this page's own
    // <img>) would keep showing the old cached image.
    const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: dbError } = await supabase
      .from("organizations")
      .update({ [column]: publicUrl })
      .eq("id", organizationId);
    if (dbError) {
      setError(dbError.message);
      setUploading(false);
      return;
    }

    setUrl(publicUrl);
    setUploading(false);
  }

  async function handleRemove() {
    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    await supabase.from("organizations").update({ [column]: null }).eq("id", organizationId);
    setUrl(null);
    setUploading(false);
  }

  return (
    <div>
      <span className="font-body text-xs text-steel uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-4 mt-2">
        <div
          className={`border border-steel/30 bg-surface flex items-center justify-center overflow-hidden shrink-0 ${previewClassName}`}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset Next can optimize.
            <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="font-body text-[10px] text-steel uppercase tracking-wide px-2 text-center">
              None set
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-xs text-steel">{helpText}</p>
          <div className="flex items-center gap-3 mt-2">
            <label className="h-9 px-3 bg-surface border border-steel/30 text-chalk font-body text-xs cursor-pointer flex items-center">
              {uploading ? "Uploading…" : url ? "Replace" : "Upload"}
              <input
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
            </label>
            {url && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="font-body text-xs text-steel disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
          {error && (
            <p className="font-body text-xs text-rust mt-1.5" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
