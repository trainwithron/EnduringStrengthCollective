"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadOrgTemplates, NO_TEMPLATES_MESSAGE, type OrgTemplate } from "@/lib/org-templates";
import { UseTemplatePanel } from "@/components/coach/desktop/use-template-panel";

// Spotlight > Program on a phone: "Start from a template" (Ron, Oct 27: templates are built on a computer; on the phone a coach only USES one). The coach's templates in the organization being
// worked in, newest changed first; a tap opens the same Use this template steps as the computer (level, client, Pick for me, Easier / Harder on every slot, Make the program / Make and assign).
export function SpotTemplates({ groupId }: { groupId: string }) {
  const [templates, setTemplates] = useState<OrgTemplate[] | null | "failed">(null);
  const [open, setOpen] = useState<OrgTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const list = await loadOrgTemplates(supabase, user.id, groupId);
      if (!cancelled) setTemplates(list ?? "failed");
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <section className="mt-4" aria-labelledby="spot-templates" data-spot-templates>
      <h3 id="spot-templates" className="font-display uppercase text-xs tracking-wide text-steel mb-2">
        Start from a template
      </h3>
      {templates === null ? (
        <p className="font-body text-xs text-steel">One moment…</p>
      ) : templates === "failed" ? (
        <p className="font-body text-xs text-rust" role="alert">
          Couldn&apos;t load your templates. Close this and try again.
        </p>
      ) : templates.length === 0 ? (
        <p className="font-body text-xs text-steel">{NO_TEMPLATES_MESSAGE}</p>
      ) : (
        <ul className="divide-y divide-steel/15 border border-steel/20">
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setOpen(t)} className="w-full min-h-11 px-3 py-2 flex items-center justify-between gap-3 text-left active:bg-rust/5">
                <span className="font-body text-sm text-chalk truncate">{t.name}</span>
                <span className="font-body text-xs text-steel shrink-0">
                  {t.slotCount} {t.slotCount === 1 ? "slot" : "slots"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <UseTemplatePanel programId={open.id} programName={open.name} groupId={open.groupId} onClose={() => setOpen(null)} onChanged={() => {}} />}
    </section>
  );
}
