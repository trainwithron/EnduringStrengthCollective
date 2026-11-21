"use client";

import { useState } from "react";

// "Want a hand moving in?" (Ron, Nov 20, onboarding O5): a coach asks a real person to help move their clients over. A short form; the answer comes by email.
export function MoveInHelpButton() {
  const [open, setOpen] = useState(false);
  const [fromApp, setFromApp] = useState("");
  const [clients, setClients] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm focus:outline-none focus:border-rust";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/move-in-help", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromApp, clients, note }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send that. Try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="font-body text-xs text-positive" data-move-in-help-sent>Sent. We&apos;ll email you to set up a time to move your clients in together.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="font-body text-xs text-rust-ink underline underline-offset-2 min-h-11" data-move-in-help>
        Want a hand moving in? Ask for help
      </button>
    );
  }
  return (
    <form onSubmit={send} className="space-y-2 max-w-sm" data-move-in-help-form>
      <div>
        <label htmlFor="move-from" className="font-body text-xs text-steel">
          Which app are you moving from?
        </label>
        <input id="move-from" value={fromApp} onChange={(e) => setFromApp(e.target.value)} placeholder="TrueCoach, Trainerize, a spreadsheet…" className={input} maxLength={60} />
      </div>
      <div>
        <label htmlFor="move-count" className="font-body text-xs text-steel">
          About how many clients?
        </label>
        <input id="move-count" value={clients} onChange={(e) => setClients(e.target.value)} inputMode="numeric" className={input} maxLength={20} />
      </div>
      <div>
        <label htmlFor="move-note" className="font-body text-xs text-steel">
          Anything else (optional)
        </label>
        <textarea id="move-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="w-full mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust" />
      </div>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Sending…" : "Ask for help"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="font-body text-xs text-steel">
          Cancel
        </button>
      </div>
    </form>
  );
}
