"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadAssignableClients, type AssignClient } from "@/lib/assign-clients";
import { findLikeReference } from "@/lib/like-client";

const TRIGGER = /(?:like|similar to|same as|as with|same protocols?)\s+[a-z]|'s\s+(?:protocols?|restrictions?|limits?|limitations?|bad|back|knee|shoulder|hip|injur)/i;
const button = "min-h-11 px-4 font-body text-sm";

// Under a box where the coach describes who the work is for: when the words point at another of their clients ("similar to Rob's bad back", "same protocols as Rob Derrick"), one line says the AI will use how
// the coach programs for that client as a REFERENCE for this request, with a way to cancel. Nothing is copied or stored on anyone. Two clients with that first name: the coach picks.
export function LikeClientSuggestion({ text, groupId, athleteId, onUse }: { text: string; groupId: string; athleteId: string | null; onUse: (referenceClientId: string | null) => void }) {
  const [clients, setClients] = useState<AssignClient[] | null>(null);
  const [options, setOptions] = useState<AssignClient[]>([]);
  const [reference, setReference] = useState<AssignClient | null>(null);
  const [cancelled, setCancelled] = useState<string | null>(null);

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
    const timer = setTimeout(() => {
      const ref = triggered && clients ? findLikeReference(text, clients, athleteId) : null;
      if (!ref) {
        setOptions([]);
        if (reference) {
          setReference(null);
          onUse(null);
        }
        return;
      }
      if (ref.client) {
        setOptions([]);
        if (cancelled === ref.client.id) return;
        if (reference?.id !== ref.client.id) {
          setReference(ref.client);
          onUse(ref.client.id);
        }
      } else {
        setOptions(ref.options);
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, clients, triggered, athleteId, cancelled]);

  function pick(c: AssignClient) {
    setOptions([]);
    setReference(c);
    onUse(c.id);
  }

  function cancel() {
    setCancelled(reference?.id ?? null);
    setReference(null);
    onUse(null);
  }

  if (options.length > 1) {
    return (
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3" role="status">
        <p className="font-body text-sm text-chalk">Which client?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((c) => (
            <button key={c.id} type="button" onClick={() => pick(c)} className={`${button} border border-rust text-rust`}>
              {c.fullName}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (reference) {
    const first = reference.fullName.trim().split(/\s+/)[0];
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-3 font-body text-sm text-chalk" role="status">
        <span>Using how you program for {first} as a reference</span>
        <button type="button" onClick={cancel} className={`${button} text-steel underline`}>
          Cancel
        </button>
      </p>
    );
  }
  return null;
}
