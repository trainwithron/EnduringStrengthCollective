"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/shared/confirm-dialog";

export interface SavedUpload {
  id: string;
  created_at: string;
  source: string;
  sessions_saved: number;
  athletes_count: number;
  records_count: number;
  kept_count: number;
  replaced_count: number;
  first_day: string | null;
  last_day: string | null;
  undone_at: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayRange = (a: string | null, b: string | null) => (!a ? "" : a === b || !b ? a : `${a} to ${b}`);

// What has been saved from uploaded sheets, newest first, each with Undo (unless it already was undone).
export function TeamSheetSavedUploads({ groupId, uploads }: { groupId: string; uploads: SavedUpload[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(u: SavedUpload) {
    if (busy) return;
    if (!(await confirmDialog({ message: `Undo the upload from ${when(u.created_at)}? Its ${u.sessions_saved} workout${u.sessions_saved === 1 ? "" : "s"} are deleted, and any records it set go back to what they were.`, confirmLabel: "Undo upload", destructive: true }))) return;
    setBusy(u.id);
    setError(null);
    try {
      const res = await fetch("/api/team-sheet/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, batchId: u.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Couldn't undo that upload.");
      else router.refresh();
    } catch {
      setError("Couldn't undo that upload. Check your connection and try again.");
    }
    setBusy(null);
  }

  if (uploads.length === 0) return <p className="font-body text-sm text-steel">Nothing has been saved from an uploaded sheet yet.</p>;
  return (
    <div className="space-y-3">
      {error && (
        <p className="font-body text-sm text-rust" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-steel/15 border border-steel/20">
        {uploads.map((u) => (
          <li key={u.id} className="p-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-body text-sm">
                {when(u.created_at)}: {u.sessions_saved} workout{u.sessions_saved === 1 ? "" : "s"} for {u.athletes_count} athlete{u.athletes_count === 1 ? "" : "s"}
                {u.first_day ? `, ${dayRange(u.first_day, u.last_day)}` : ""}
              </p>
              <p className="font-body text-xs text-steel">
                {u.source === "csv" ? "CSV" : "Excel"}
                {u.records_count > 0 ? `, ${u.records_count} new record${u.records_count === 1 ? "" : "s"}` : ""}
                {u.kept_count > 0 ? `, ${u.kept_count} left as they were` : ""}
                {u.replaced_count > 0 ? `, ${u.replaced_count} replaced` : ""}
              </p>
            </div>
            {u.undone_at ? (
              <span className="font-body text-xs text-steel">Undone {when(u.undone_at)}</span>
            ) : (
              <button type="button" onClick={() => undo(u)} disabled={busy === u.id} className="h-11 px-4 border border-steel/40 text-chalk font-body text-sm hover:border-rust disabled:opacity-40">
                {busy === u.id ? "Undoing..." : "Undo"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
