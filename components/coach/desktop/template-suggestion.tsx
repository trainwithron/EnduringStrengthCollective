"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadAssignableClients } from "@/lib/assign-clients";
import { clientNamedIn, matchTemplates, type TemplateRef } from "@/lib/template-match";
import { UseTemplatePanel } from "@/components/coach/desktop/use-template-panel";

// Under the AI Program Builder box and the Ask box: when what the coach is typing clearly names one of their templates ("the 30-year-old mom of two template"), offer to use that template instead. It only
// offers; opening it shows the usual Use this template panel with the words already in the "who is it for" box, and a client named in them chosen. Nothing is written by the AI here.
export function TemplateSuggestion({ text }: { text: string }) {
  const [templates, setTemplates] = useState<TemplateRef[] | null>(null);
  const [matches, setMatches] = useState<TemplateRef[]>([]);
  const [clientId, setClientId] = useState("");
  const [open, setOpen] = useState<TemplateRef | null>(null);
  const loading = useRef(false);

  // The coach's templates are fetched once, the first time the words are long enough to name one.
  useEffect(() => {
    if (templates !== null || loading.current || text.trim().length < 12) return;
    loading.current = true;
    void (async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("group_workout_exercises")
        .select("workouts!inner ( program_id, programs!inner ( id, name, group_id, athlete_id, archived_at ) )")
        .eq("is_slot", true)
        .limit(2000);
      const seen = new Map<string, TemplateRef>();
      for (const r of (data ?? []) as any[]) {
        const p = r.workouts?.programs;
        if (p && !p.athlete_id && !p.archived_at && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name, groupId: p.group_id });
      }
      setTemplates([...seen.values()]);
    })();
  }, [text, templates]);

  useEffect(() => {
    if (!templates) return;
    const timer = setTimeout(async () => {
      const found = matchTemplates(text, templates);
      setMatches(found);
      setClientId("");
      if (found.length === 0) return;
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const clients = await loadAssignableClients(supabase, user.id, found[0].groupId).catch(() => []);
      setClientId(clientNamedIn(text, clients)?.id ?? "");
    }, 500);
    return () => clearTimeout(timer);
  }, [text, templates]);

  if (matches.length === 0) return null;
  return (
    <>
      <div className="mt-2 border border-steel/30 bg-surface/40 p-3" role="status">
        {matches.length === 1 ? (
          <>
            <p className="font-body text-sm text-chalk">Use your template &lsquo;{matches[0].name}&rsquo; for this?</p>
            <button type="button" onClick={() => setOpen(matches[0])} className="mt-2 min-h-11 px-4 border border-rust text-rust font-body text-sm">
              Open template
            </button>
          </>
        ) : (
          <>
            <p className="font-body text-sm text-chalk">Which template?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {matches.map((m) => (
                <button key={m.id} type="button" onClick={() => setOpen(m)} className="min-h-11 px-4 border border-rust text-rust font-body text-sm">
                  {m.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {open && <UseTemplatePanel programId={open.id} programName={open.name} groupId={open.groupId} initialText={text} initialClientId={clientId} onClose={() => setOpen(null)} onChanged={() => {}} />}
    </>
  );
}
