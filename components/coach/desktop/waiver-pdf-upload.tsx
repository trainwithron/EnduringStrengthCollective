"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;

// Same private-bucket + signed-URL convention as exercise-media-picker.tsx —
// an optional replacement for the built-in waiver text, for a coach who
// already has their own lawyer-reviewed PDF.
export function WaiverPdfUpload({
  organizationId,
  initialPath,
}: {
  organizationId: string;
  initialPath: string | null;
}) {
  const [path, setPath] = useState(initialPath);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Use a PDF file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be under 10MB.");
      return;
    }

    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    const newPath = `${organizationId}/${crypto.randomUUID()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("waiver-documents")
      .upload(newPath, file);
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase
      .from("organizations")
      .update({ waiver_pdf_path: newPath })
      .eq("id", organizationId);
    if (dbError) {
      setError(dbError.message);
      setUploading(false);
      return;
    }

    if (path) {
      await supabase.storage.from("waiver-documents").remove([path]);
    }
    setPath(newPath);
    setUploading(false);
  }

  async function handleRemove() {
    setUploading(true);
    setError(null);
    const supabase = createBrowserClient();
    await supabase.from("organizations").update({ waiver_pdf_path: null }).eq("id", organizationId);
    if (path) {
      await supabase.storage.from("waiver-documents").remove([path]);
    }
    setPath(null);
    setUploading(false);
  }

  return (
    <div>
      <p className="font-body text-xs text-steel mb-2">
        Optional: upload your own PDF instead of the built-in text below. When set, clients see this
        PDF and check a box confirming they&apos;ve read it, instead of the text.
      </p>
      <div className="flex items-center gap-3">
        <label className="h-9 px-3 bg-surface border border-steel/30 text-chalk font-body text-xs cursor-pointer flex items-center">
          {uploading ? "Uploading…" : path ? "Replace PDF" : "Upload PDF"}
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
        {path && (
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
  );
}
