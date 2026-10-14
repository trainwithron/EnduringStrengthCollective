"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadAssignableClients, type AssignClient } from "@/lib/assign-clients";
import { findLikeReference, namedClausesIn } from "@/lib/like-client";
import { labelFor } from "@/lib/clauses";

interface Preview {
  referenceName: string;
  clauses: { key: string; label: string }[];
  rules: { text: string; clauseKeys: string[] }[];
}

const TRIGGER = /(?:like|similar to|same as|as with|same protocols?|same clauses?)\s+[a-z]|'s\s+(?:protocols?|clauses?|restrictions?|limits?|limitations?|bad|back|knee|shoulder|hip|injur)|\bclause\b/i;
const button = "min-h-11 px-4 font-body text-sm";

// Under a box where the coach describes who the work is for: when the words point at another of their clients ("similar to Rob's bad back", "same protocols as Rob Derrick") or name a clause ("this client has
// a no rotation clause"), show what that means ("Using Rob's clauses: Back limits (no barbell squats), ...") with Use / Cancel and a tick per clause to edit. Use applies those clauses to THIS request, and
// once offers to put the same clauses on the new client's profile. A one-time copy, never a link. Clause names and rule sentences only; the coach's own clients, inside one organization.
export function LikeClientSuggestion({
  text,
  groupId,
  athleteId,
  onUse,
}: {
  text: string;
  groupId: string;
  // The client the work is for, if there is one (so the clauses can be offered for their profile).
  athleteId: string | null;
  // The clause keys to use for this request (empty = stopped).
  onUse: (keys: string[]) => void;
}) {
  const [clients, setClients] = useState<AssignClient[] | null>(null);
  const [options, setOptions] = useState<AssignClient[]>([]);
  const [reference, setReference] = useState<AssignClient | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [direct, setDirect] = useState<string[]>([]);
  const [using, setUsing] = useState<{ label: string; keys: string[] } | null>(null);
  const [offerAdd, setOfferAdd] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const triggered = TRIGGER.test(text);

  useEffect(() => {
    if (!triggered || clients !== null) return;
    void (async () => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setClients(user ? await loadAssignableClients(supabase, user.id, groupId).catch(() => []) : []);
    })();
  }, [triggered, clients, groupId]);

  useEffect(() => {
    if (!triggered || using) return;
    const timer = setTimeout(async () => {
      const key = text.trim().toLowerCase();
      if (dismissed === key) return;
      setDirect(namedClausesIn(text));
      const ref = clients ? findLikeReference(text, clients, athleteId) : null;
      setOptions(ref && !ref.client ? ref.options : []);
      if (ref?.client && ref.client.id !== reference?.id) {
        setReference(ref.client);
        const res = await fetch("/api/learning/protocol", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "preview", groupId, referenceClientId: ref.client.id }),
        }).catch(() => null);
        const json = res?.ok ? ((await res.json().catch(() => null)) as Preview | null) : null;
        setPreview(json && json.clauses.length > 0 ? json : null);
        setPicked(json ? json.clauses.map((c) => c.key) : []);
      } else if (!ref) {
        setReference(null);
        setPreview(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [text, clients, triggered, using, dismissed, groupId, athleteId, reference?.id]);

  function chooseOption(c: AssignClient) {
    setOptions([]);
    setReference(null);
    // Re-run with the one picked: the next pass finds exactly this client by full name.
    setClients((prev) => (prev ?? []).filter((x) => x.id === c.id || !options.some((o) => o.id === x.id)));
  }

  function use(keys: string[], label: string) {
    if (keys.length === 0) return;
    setUsing({ label, keys });
    onUse(keys);
    setPreview(null);
    setDirect([]);
    // Once, offer to put the same clauses on the new client's profile.
    if (athleteId) setOfferAdd(keys);
  }

  async function addToProfile() {
    if (!reference && athleteId) {
      // Clauses the coach named directly go on the profile with their usual names.
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error: e } = await supabase.from("client_clauses").upsert(offerAdd.map((k) => ({ coach_id: user.id, athlete_id: athleteId, group_id: groupId, key: k, label: labelFor(k) })), { onConflict: "coach_id,athlete_id,key", ignoreDuplicates: true });
        if (e) setError("That didn't save. Nothing was changed.");
      }
      setOfferAdd([]);
      return;
    }
    if (!reference || !athleteId) {
      setOfferAdd([]);
      return;
    }
    const res = await fetch("/api/learning/protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "copy", groupId, referenceClientId: reference.id, targetClientId: athleteId, keys: offerAdd }),
    }).catch(() => null);
    if (!res?.ok) setError("That didn't save. Nothing was changed.");
    setOfferAdd([]);
  }

  function stop() {
    setUsing(null);
    setOfferAdd([]);
    setDismissed(text.trim().toLowerCase());
    onUse([]);
  }

  if (using) {
    return (
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3" role="status">
        <p className="font-body text-sm text-chalk">{using.label}</p>
        {offerAdd.length > 0 && athleteId && (
          <div className="mt-2">
            <p className="font-body text-xs text-steel">Add {offerAdd.map((k) => `'${labelFor(k)}'`).join(" and ")} to this client&apos;s profile?</p>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => void addToProfile()} className={`${button} bg-rust text-graphite`}>
                Add
              </button>
              <button type="button" onClick={() => setOfferAdd([])} className={`${button} text-steel`}>
                No
              </button>
            </div>
          </div>
        )}
        <button type="button" onClick={stop} className={`${button} text-steel underline`}>
          Stop using these
        </button>
        {error && (
          <p className="font-body text-xs text-rust" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (options.length > 1) {
    return (
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3" role="status">
        <p className="font-body text-sm text-chalk">Which client?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((c) => (
            <button key={c.id} type="button" onClick={() => chooseOption(c)} className={`${button} border border-rust text-rust`}>
              {c.fullName}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (preview && reference) {
    return (
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3 space-y-2" role="group" aria-label={`${preview.referenceName}'s clauses`}>
        <p className="font-body text-sm text-chalk">Using {preview.referenceName}&apos;s clauses as a starting point:</p>
        <ul className="space-y-1">
          {preview.clauses.map((c) => {
            const rules = preview.rules.filter((r) => r.clauseKeys.includes(c.key)).map((r) => r.text);
            return (
              <li key={c.key}>
                <label className="flex items-start gap-2 min-h-11 font-body text-sm text-chalk cursor-pointer">
                  <input type="checkbox" checked={picked.includes(c.key)} onChange={() => setPicked((p) => (p.includes(c.key) ? p.filter((k) => k !== c.key) : [...p, c.key]))} className="mt-1" />
                  <span>
                    {c.label}
                    {rules.length > 0 && <span className="text-steel"> ({rules.slice(0, 3).join(", ")})</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <button type="button" onClick={() => use(picked, `Using ${preview.referenceName}'s clauses: ${picked.map((k) => labelFor(k)).join(", ")}`)} disabled={picked.length === 0} className={`${button} bg-rust text-graphite disabled:opacity-40`}>
            Use
          </button>
          <button type="button" onClick={() => { setPreview(null); setDismissed(text.trim().toLowerCase()); }} className={`${button} text-steel`}>
            Cancel
          </button>
        </div>
        <p className="font-body text-xs text-steel">A starting point only. Nothing changes on {preview.referenceName}&apos;s profile, and edits here never flow back.</p>
      </div>
    );
  }

  if (direct.length > 0 && !reference) {
    return (
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3 space-y-2" role="group" aria-label="Clause">
        <p className="font-body text-sm text-chalk">Using the clause: {direct.map((k) => labelFor(k)).join(", ")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => use(direct, `Using the clause: ${direct.map((k) => labelFor(k)).join(", ")}`)} className={`${button} bg-rust text-graphite`}>
            Use
          </button>
          <button type="button" onClick={() => { setDirect([]); setDismissed(text.trim().toLowerCase()); }} className={`${button} text-steel`}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return null;
}
