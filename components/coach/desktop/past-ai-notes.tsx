"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { NoteBullet, RawEntry } from "@/lib/client-notes";

// One quiet link, only when a client is chosen: "Past AI build notes". It opens the short list of important facts the AI keeps about this client (about eight words each, dated), where the coach can fix
// or delete any of them, and the coach's own recent requests (kept 30 days, only the coach sees them). No page, no badge, no prompts.
export function PastAiNotes({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [raw, setRaw] = useState<RawEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function show() {
    setOpen((v) => !v);
    if (bullets !== null) return;
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("client_ai_notes").select("bullets, raw").eq("coach_id", user.id).eq("athlete_id", athleteId).maybeSingle();
    const row = data as { bullets?: NoteBullet[] | null; raw?: RawEntry[] | null } | null;
    setBullets((row?.bullets ?? []).map((b) => b.text));
    setRaw(row?.raw ?? []);
  }

  async function save(next: string[]) {
    setError(null);
    setSaved(false);
    const res = await fetch("/api/learning/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save", groupId, athleteId, bullets: next }) }).catch(() => null);
    if (!res?.ok) {
      setError("That didn't save. Nothing was changed.");
      return;
    }
    const json = (await res.json().catch(() => null)) as { bullets?: NoteBullet[] } | null;
    setBullets((json?.bullets ?? []).map((b) => b.text));
    setSaved(true);
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => void show()} aria-expanded={open} className="min-h-11 font-body text-xs text-steel underline underline-offset-2">
        Past AI build notes
      </button>
      {open && (
        <div className="border border-steel/20 bg-surface/30 p-3 space-y-2" role="group" aria-label="Past AI build notes">
          <p className="font-body text-xs text-steel">Short notes the AI keeps from what you tell it about this client. Fix or delete anything. Only you see them.</p>
          {bullets === null ? (
            <p className="font-body text-sm text-steel">One moment…</p>
          ) : bullets.length === 0 ? (
            <p className="font-body text-sm text-steel">Nothing yet. Important things you tell the AI about this client will show up here.</p>
          ) : (
            <ul className="space-y-1">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={b}
                    maxLength={70}
                    onChange={(e) => setBullets((prev) => (prev ?? []).map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => void save(bullets)}
                    aria-label={`Note ${i + 1}`}
                    className="flex-1 min-w-0 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
                  />
                  <button type="button" onClick={() => void save(bullets.filter((_, j) => j !== i))} aria-label={`Delete note ${i + 1}`} className="w-11 h-11 flex items-center justify-center text-steel active:text-rust">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {raw.length > 0 && (
            <details>
              <summary className="min-h-11 flex items-center font-body text-xs text-steel cursor-pointer">Your recent requests (kept 30 days)</summary>
              <ul className="space-y-1">
                {raw
                  .slice()
                  .reverse()
                  .map((r) => (
                    <li key={r.at} className="font-body text-xs text-steel">
                      {r.at.slice(0, 10)}: {r.text}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {saved && (
            <p className="font-body text-xs text-steel" role="status">
              Saved.
            </p>
          )}
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
