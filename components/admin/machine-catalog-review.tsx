"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export interface ReviewRequest {
  id: string;
  kind: "machine" | "demo";
  from: string;
  sentAt: string;
  // The machine's name (a new machine's brand and model, or the shared machine a demo is for).
  machine: string | null;
  // A new machine's exercises.
  exercises: string[];
  // The exercise a demo is for.
  exercise: string | null;
  videoUrl: string | null;
  youtubeEmbed: string | null;
  youtubeUrl: string | null;
  // The exercise already has a demo: approving replaces it.
  replaces: boolean;
}

// Approve or Deny each waiting request, with an optional note for the coach (review_catalog_request(): the platform admin only, checked on the server).
export function MachineCatalogReview({ requests }: { requests: ReviewRequest[] }) {
  const [done, setDone] = useState<Record<string, "approved" | "denied">>({});
  if (requests.length === 0) return <p className="font-body text-sm text-steel mt-6">Nothing waiting.</p>;
  return (
    <ul className="mt-6 max-w-2xl space-y-4" data-catalog-review>
      {requests.map((r) => (
        <ReviewCard key={r.id} request={r} outcome={done[r.id] ?? null} onDone={(o) => setDone((prev) => ({ ...prev, [r.id]: o }))} />
      ))}
    </ul>
  );
}

function ReviewCard({ request: r, outcome, onDone }: { request: ReviewRequest; outcome: "approved" | "denied" | null; onDone: (o: "approved" | "denied") => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createBrowserClient().rpc("review_catalog_request", { p_request_id: r.id, p_approve: approve, p_note: note.trim() || null });
    setBusy(false);
    if (rpcError) return setError(/already reviewed/.test(rpcError.message) ? "That request was already reviewed." : /no longer on the shared list/.test(rpcError.message) ? "That exercise is no longer on the shared list. Deny it instead." : "That didn't save. Try again.");
    onDone(approve ? "approved" : "denied");
    router.refresh();
  }

  return (
    <li className="border border-steel/20 p-3 space-y-3" data-review-request={r.id}>
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide">
          {r.kind === "machine" ? "New machine" : "Demo"} · {r.from} · {new Date(r.sentAt).toLocaleDateString()}
        </p>
        <p className="font-body text-[15px] text-chalk font-medium mt-1 break-words">
          {r.kind === "machine" ? r.machine : `${r.exercise ?? "Exercise"} on ${r.machine ?? "a shared machine"}`}
        </p>
        {r.kind === "machine" && (
          <ol className="mt-1 font-body text-sm text-chalk list-decimal pl-5">
            {r.exercises.map((e) => (
              <li key={e} className="break-words">
                {e}
              </li>
            ))}
          </ol>
        )}
        {r.replaces && <p className="font-body text-xs text-steel mt-1">Approving replaces the demo it has now.</p>}
        {/* What the coach ticked (Ron, Nov 20, S4): the database refuses a demo without these, so they are always ticked here. */}
        {r.kind === "demo" && (
          <p className="font-body text-xs text-steel mt-1" data-ticked>
            {r.youtubeUrl
              ? "They ticked: this is their video, or they have the right to share it."
              : "They ticked: they filmed it and have the right to share it, and everyone shown agreed to be filmed and shared (a parent's OK for anyone under 18)."}
          </p>
        )}
      </div>
      {r.videoUrl ? (
        <video src={r.videoUrl} controls playsInline preload="metadata" className="w-full bg-surface aspect-video" />
      ) : r.youtubeEmbed ? (
        <div className="w-full aspect-video">
          <iframe src={r.youtubeEmbed} title={r.exercise ?? "Demo"} allow="encrypted-media; picture-in-picture" allowFullScreen className="w-full h-full" />
        </div>
      ) : r.kind === "demo" ? (
        <p className="font-body text-xs text-rust">The video can&apos;t be played here.</p>
      ) : null}
      {outcome ? (
        <p className={`font-body text-sm ${outcome === "approved" ? "text-positive" : "text-steel"}`} role="status">
          {outcome === "approved" ? "Approved: it's on the shared list." : "Denied: nothing went on the list."}
        </p>
      ) : (
        <>
          <label className="block">
            <span className="font-body text-xs text-steel">Note for the coach (optional)</span>
            <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-base sm:text-sm focus:outline-none focus:border-rust" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void review(true)} disabled={busy} className="flex-1 min-h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              Approve
            </button>
            <button type="button" onClick={() => void review(false)} disabled={busy} className="flex-1 min-h-11 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
              Deny
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
