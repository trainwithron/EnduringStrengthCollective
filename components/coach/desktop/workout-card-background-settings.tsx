"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

const AI_PROMPT = `A vertical (9:16) photo-realistic background scene for a fitness app card. [Describe your gym or city — e.g. "the interior of a modern gym at golden hour, looking out a large window over the Las Vegas skyline and mountains"]. Warm, cinematic lighting. No people, no text, no logos, no watermarks. Leave the upper-middle third relatively simple and uncluttered — a stat card will be overlaid there.`;

// Post-workout share card's background sourcing
// (post_workout_card_v1_bevel_and_animation.md, Direction D) — tucked
// into Branding settings where a coach is already looking for identity
// controls, not advertised with a callout. Three options shown
// together, none blocking the others: upload a real photo, generate one
// externally via a copy-paste prompt (which becomes an upload once
// they have a result), or leave it on the built-in default rotation.
export function WorkoutCardBackgroundSettings({
  organizationId,
  initialMode,
  initialUrl,
}: {
  organizationId: string;
  initialMode: "default_rotation" | "custom";
  initialUrl: string | null;
}) {
  const [mode, setMode] = useState(initialMode);
  const [url, setUrl] = useState(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function persistMode(next: "default_rotation" | "custom") {
    setMode(next);
    const supabase = createBrowserClient();
    await supabase
      .from("organizations")
      .update({ workout_card_background_mode: next })
      .eq("id", organizationId);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 8MB.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${organizationId}/workout-card-bg.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("org-branding")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from("org-branding").getPublicUrl(path);
    const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: dbError } = await supabase
      .from("organizations")
      .update({ workout_card_background_url: publicUrl, workout_card_background_mode: "custom" })
      .eq("id", organizationId);
    if (dbError) {
      setError(dbError.message);
      setUploading(false);
      return;
    }

    setUrl(publicUrl);
    setMode("custom");
    setUploading(false);
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(AI_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl">
      <h4 className="font-display uppercase text-lg font-bold mb-1">Workout Card Background</h4>
      <p className="font-body text-xs text-steel mb-5">
        Shown behind an athlete&apos;s post-workout share card. Leave as-is for the default
        rotation.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <button
          type="button"
          onClick={() => document.getElementById("workout-card-bg-upload")?.click()}
          className={`border rounded-token-lg p-4 text-center font-body text-xs ${
            mode === "custom" && url
              ? "border-rust bg-rust/[0.08] text-chalk"
              : "border-steel/20 bg-graphite text-steel"
          }`}
        >
          <span className="text-xl block mb-2">🖼️</span>
          <span className="font-display font-bold text-sm uppercase block mb-0.5 text-chalk">
            Upload Image
          </span>
          Use your own photo
        </button>
        <div className="border border-steel/20 bg-graphite rounded-token-lg p-4 text-center font-body text-xs text-steel">
          <span className="text-xl block mb-2">✨</span>
          <span className="font-display font-bold text-sm uppercase block mb-0.5 text-chalk">
            Generate with AI
          </span>
          Copy a prompt below
        </div>
        <button
          type="button"
          onClick={() => persistMode("default_rotation")}
          className={`border rounded-token-lg p-4 text-center font-body text-xs ${
            mode === "default_rotation"
              ? "border-rust bg-rust/[0.08] text-chalk"
              : "border-steel/20 bg-graphite text-steel"
          }`}
        >
          <span className="text-xl block mb-2">🎲</span>
          <span className="font-display font-bold text-sm uppercase block mb-0.5 text-chalk">
            Default Rotation
          </span>
          Leave it to us — no setup
        </button>
      </div>

      <input
        id="workout-card-bg-upload"
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleFileChange}
        disabled={uploading}
        className="hidden"
      />

      {mode === "custom" && url && (
        <div className="mb-5 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */}
          <img
            src={url}
            alt="Workout card background"
            className="w-24 h-40 object-cover rounded-token-lg border border-steel/30"
          />
          <div>
            <p className="font-body text-xs text-steel mb-2">
              {uploading ? "Uploading…" : "Current background"}
            </p>
            <button
              type="button"
              onClick={() => document.getElementById("workout-card-bg-upload")?.click()}
              disabled={uploading}
              className="h-8 px-3 border border-steel/30 text-chalk font-body text-xs"
            >
              Replace
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-rust mb-4" role="alert">
          {error}
        </p>
      )}

      <div className="border border-steel/20 bg-graphite rounded-token-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-[10px] text-steel uppercase tracking-wide">
            Copy this into ChatGPT, Gemini, or any image-generation tool
          </p>
          <button
            type="button"
            onClick={copyPrompt}
            className="h-7 px-3 bg-rust text-graphite font-display font-bold text-[11px] uppercase rounded-token-sm shrink-0"
          >
            {copied ? "Copied!" : "Copy Prompt"}
          </button>
        </div>
        <pre className="font-body text-xs text-chalk whitespace-pre-wrap leading-relaxed">
          {AI_PROMPT}
        </pre>
        <p className="font-body text-[11px] text-steel mt-3">
          Paste the result back in as an upload once you&apos;ve generated one you like. Nothing
          is sent to any AI service on our end — this just hands you a prompt that works well
          with the card layout.
        </p>
      </div>
    </div>
  );
}
