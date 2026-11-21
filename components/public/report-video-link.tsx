"use client";

import { useState } from "react";
import { REPORT_REASONS, reportReasonLabel, type ReportReason } from "@/lib/video-reports";

// "Report this video" on the public scan pages (Ron, Nov 20, S4): a small link that opens a short form (which video, why, an optional note) and sends it to Spotlight. Works signed
// out. On a machine's page with several exercises the visitor picks which one.
export function ReportVideoLink({ videos, machineId }: { videos: { id: string; name: string }[]; machineId: string | null }) {
  const [open, setOpen] = useState(false);
  const [exerciseId, setExerciseId] = useState(videos.length === 1 ? videos[0].id : "");
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (videos.length === 0) return null;
  if (sent) {
    return (
      <p className="font-body text-xs text-steel text-center mt-8" role="status">
        Thanks. Spotlight will look at it and remove it if it shouldn&apos;t be here.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="text-center mt-8">
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-2 font-body text-xs text-steel underline">
          Report this video
        </button>
      </div>
    );
  }

  async function send() {
    if (!exerciseId) return setError("Pick the video.");
    if (!reason) return setError("Pick a reason.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/public/report-video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exerciseId, machineId, reason, note }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const out = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setError(out?.error ?? "That didn't send. Try again.");
    }
    setSent(true);
  }

  return (
    <div className="mt-8 border border-steel/30 bg-surface p-3 space-y-3" data-report-video>
      <p className="font-body text-sm text-chalk">Report a video</p>
      {videos.length > 1 && (
        <select
          aria-label="Which video"
          value={exerciseId}
          onChange={(e) => setExerciseId(e.target.value)}
          className="w-full min-h-11 bg-graphite border border-steel/30 px-2 text-chalk font-body text-base sm:text-sm"
        >
          <option value="">Which video?</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      <fieldset className="space-y-1">
        <legend className="font-body text-xs text-steel mb-1">Why?</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-3 min-h-11 font-body text-sm text-chalk">
            <input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} className="w-5 h-5 accent-rust shrink-0" />
            {reportReasonLabel(r)}
          </label>
        ))}
      </fieldset>
      <textarea
        aria-label="Anything else (optional)"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Anything else (optional)"
        className="w-full bg-graphite border border-steel/30 text-chalk px-3 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust resize-none"
      />
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => void send()} disabled={busy} className="flex-1 min-h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-11 px-4 border border-steel/40 text-chalk font-body text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
