"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Delete } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/group/sign-out-button";
import { FRONT_DESK_MIN_QUERY, checkInMessage, type FrontDeskMatch } from "@/lib/front-desk";

type View = { mode: "search" } | { mode: "pin"; client: FrontDeskMatch } | { mode: "confirmed"; name: string; at: string };

// Large-format and tablet-friendly, like the group kiosk. The client types their name (or the person at the desk does), then their own four-digit code; the answer from the database is one of ok / wrong / locked / no code.
// Names are looked up a few at a time as someone types (never the whole client list on the tablet).
export function FrontDeskScreen({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [view, setView] = useState<View>({ mode: "search" });
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FrontDeskMatch[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const mine = ++latest.current;
    if (q.length < FRONT_DESK_MIN_QUERY) {
      setMatches([]);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data, error: rpcError } = await createBrowserClient().rpc("front_desk_find", { p_org: organizationId, p_query: q });
        if (mine !== latest.current) return;
        if (rpcError) {
          setSearchError("Couldn't look that up. Try again.");
          setMatches([]);
          return;
        }
        setSearchError(null);
        setMatches((data ?? []) as FrontDeskMatch[]);
      } catch {
        if (mine === latest.current) setSearchError("Couldn't look that up. Try again.");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, organizationId]);

  function openPin(client: FrontDeskMatch) {
    setPin("");
    setError(null);
    setView({ mode: "pin", client });
  }

  async function submit(client: FrontDeskMatch, fullPin: string) {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await createBrowserClient().rpc("front_desk_check_in", { p_group: client.group_id, p_athlete: client.athlete_id, p_pin: fullPin });
      const result = data as { result?: string; checked_in_at?: string } | null;
      if (rpcError || !result) {
        setError(checkInMessage("error"));
        setPin("");
        setSubmitting(false);
        return;
      }
      if (result.result !== "ok") {
        setError(checkInMessage(result.result ?? "error"));
        setPin("");
        setSubmitting(false);
        return;
      }
      setView({ mode: "confirmed", name: client.full_name ?? "Client", at: result.checked_in_at ?? new Date().toISOString() });
      setSubmitting(false);
      setTimeout(() => {
        setView({ mode: "search" });
        setQuery("");
        setMatches([]);
      }, 2500);
    } catch {
      setError(checkInMessage("error"));
      setPin("");
      setSubmitting(false);
    }
  }

  // The fourth digit checks the client in at once, with no extra tap.
  useEffect(() => {
    if (view.mode === "pin" && pin.length === 4 && !submitting) void submit(view.client, pin);
  }, [pin, view, submitting]);

  function pressDigit(d: string) {
    if (pin.length >= 4 || submitting) return;
    setError(null);
    setPin((prev) => prev + d);
  }

  if (view.mode === "pin") {
    const client = view.client;
    return (
      <main className="min-h-screen bg-graphite text-chalk flex flex-col items-center justify-center px-6">
        <p className="font-body text-sm text-steel mb-1">Enter your check-in code</p>
        <h1 className="font-display font-bold text-3xl uppercase mb-8">{client.full_name ?? "Client"}</h1>
        {!client.has_pin ? (
          <p className="font-body text-rust text-center max-w-xs mb-8">{checkInMessage("no_pin")}</p>
        ) : (
          <>
            <div className="flex gap-4 mb-8" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 border-rust ${i < pin.length ? "bg-rust" : "bg-transparent"}`} />
              ))}
            </div>
            {error && (
              <p className="font-body text-sm text-rust mb-4 text-center max-w-xs" role="alert">
                {error}
              </p>
            )}
            <div className="grid grid-cols-3 gap-4 w-72">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" onClick={() => pressDigit(d)} disabled={submitting} className="h-20 bg-surface border border-steel/30 font-display text-2xl disabled:opacity-40">
                  {d}
                </button>
              ))}
              <div />
              <button type="button" onClick={() => pressDigit("0")} disabled={submitting} className="h-20 bg-surface border border-steel/30 font-display text-2xl disabled:opacity-40">
                0
              </button>
              <button
                type="button"
                aria-label="Delete the last digit"
                onClick={() => {
                  setError(null);
                  setPin((prev) => prev.slice(0, -1));
                }}
                disabled={submitting}
                className="h-20 bg-surface border border-steel/30 flex items-center justify-center disabled:opacity-40"
              >
                <Delete className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
        <button type="button" onClick={() => setView({ mode: "search" })} className="mt-10 font-body text-sm text-steel underline underline-offset-2">
          Not {(client.full_name ?? "this client").split(" ")[0]}? Go back
        </button>
      </main>
    );
  }

  if (view.mode === "confirmed") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-full bg-positive/20 border-2 border-positive flex items-center justify-center mb-6">
          <span className="font-display text-4xl text-positive">✓</span>
        </div>
        <h1 className="font-display font-bold text-3xl uppercase mb-2">Checked in!</h1>
        <p className="font-body text-lg text-steel">
          {view.name} — {new Date(view.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      </main>
    );
  }

  const q = query.trim();
  return (
    <main className="min-h-screen bg-graphite text-chalk px-6 py-10">
      <h1 className="font-display font-bold text-3xl uppercase text-center mb-1">{organizationName}</h1>
      <p className="font-body text-sm text-steel text-center mb-8">Type your name to check in</p>

      <div className="max-w-md mx-auto mb-6 relative">
        <Search className="w-5 h-5 text-steel absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Your name"
          placeholder="Your name…"
          autoFocus
          className="w-full h-14 bg-surface border border-steel/30 pl-11 pr-4 font-body text-lg text-chalk focus:outline-none focus:border-rust"
        />
      </div>

      <div className="max-w-md mx-auto space-y-2 max-h-[60vh] overflow-y-auto">
        {searchError && (
          <p className="font-body text-sm text-rust text-center py-4" role="alert">
            {searchError}
          </p>
        )}
        {!searchError && q.length > 0 && q.length < FRONT_DESK_MIN_QUERY && <p className="font-body text-sm text-steel text-center py-4">Keep typing…</p>}
        {!searchError && q.length >= FRONT_DESK_MIN_QUERY && matches.length === 0 && <p className="font-body text-sm text-steel text-center py-4">No match. Check the spelling, or ask the front desk.</p>}
        {matches.map((m) => (
          <button
            key={`${m.group_id}-${m.athlete_id}`}
            type="button"
            onClick={() => openPin(m)}
            className="w-full h-16 bg-surface border border-steel/20 flex items-center px-5 font-body text-lg active:bg-rust/10 active:border-rust/40"
          >
            {m.full_name ?? "Client"}
          </button>
        ))}
      </div>

      <div className="mt-12 flex justify-center">
        <SignOutButton />
      </div>
    </main>
  );
}
