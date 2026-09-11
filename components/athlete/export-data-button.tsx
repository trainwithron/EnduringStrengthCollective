"use client";

import { useState } from "react";

export function ExportDataButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        setError("Couldn't export your data — try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="font-body text-sm text-rust disabled:opacity-40"
      >
        {downloading ? "Preparing…" : "Download my data"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
