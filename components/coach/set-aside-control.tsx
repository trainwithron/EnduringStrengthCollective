"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// On a client's profile: set the client aside as inactive, or bring them back. Nothing is deleted: their history, balance and messages stay, and a
// workout, session or message from them brings them back by itself. Hidden until the database update (0281) is applied.
export function SetAsideControl({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const [state, setState] = useState<"unknown" | "active" | "inactive" | "unavailable">("unknown");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const { data, error: loadError } = await supabase.from("client_inactive").select("since").eq("group_id", groupId).eq("athlete_id", athleteId).maybeSingle();
      if (cancelled) return;
      if (loadError) setState("unavailable");
      else setState(data ? "inactive" : "active");
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, groupId]);

  async function set(inactive: boolean) {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: rpcError } = await supabase.rpc("set_client_inactive", {
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_inactive: inactive,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError("That didn't save. Nothing was changed. Try again.");
      return;
    }
    setNote("");
    setState(inactive ? "inactive" : "active");
  }

  if (state === "unknown" || state === "unavailable") return null;

  return (
    <div className="border border-steel/20 p-4">
      <p className="font-body text-xs text-steel uppercase tracking-wide font-bold mb-1">
        {state === "inactive" ? "Set aside as inactive" : "Set aside"}
      </p>
      <p className="font-body text-xs text-steel mb-2">
        {state === "inactive"
          ? "Hidden from your dashboard, quiet-client alerts and counts. Only you can see this, not the client. Their history, sessions and messages are all still here, and a workout, session or message from them brings them back."
          : "Hide this client from your dashboard and quiet-client alerts without deleting anything. Only you can see this, not the client. A workout, session or message from them brings them back (a session you schedule for them counts). A weekly schedule you already set up keeps running until you end it."}
      </p>
      {state === "active" && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm mb-2"
        />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => set(state === "active")}
        className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm disabled:opacity-50"
      >
        {state === "inactive" ? "Bring back" : "Set aside as inactive"}
      </button>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
