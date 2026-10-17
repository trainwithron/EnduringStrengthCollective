"use client";

import { useState } from "react";

// "Export my business": one ZIP of spreadsheets with the clients, programs, workouts, sets, bookings, credits and notes of the organization the coach is standing in. A large business can take a minute.
export function ExportBusinessButton({ groupId }: { groupId: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach/export?groupId=${encodeURIComponent(groupId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't make the export. Try again.");
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "my-business-export.zip";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't make the export. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={download} disabled={working} className="h-11 px-4 border border-rust text-rust font-body text-sm font-medium disabled:opacity-40">
        {working ? "Preparing… this can take a minute" : "Export my business"}
      </button>
      <p className="font-body text-xs text-steel mt-1.5 max-w-[60ch]">A zip of spreadsheets: your clients, programs, workouts, every logged set, bookings, credits and notes. It is yours to keep, any time.</p>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
