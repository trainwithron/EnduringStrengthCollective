"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

export interface ClientTagRow {
  id: string;
  name: string;
  gatesRevenueSplit: boolean;
}

// organizational_only_group_kind_idea_sept16.md — org-scoped client
// segmentation labels ("In-Home", "Coast to Coast," "Pay-Split
// Clients"), deliberately a lightweight tag table rather than a real
// `groups` row — see that memory's own scoping for why a 4th group_kind
// value was rejected. One designated tag can gate the revenue-split
// transfer logic (createRevenueSplitTransfers) — flipping "Gates
// revenue split" on a tag unsets it on any other, since only one tag
// per org can mean that.
export function ClientTagManager({
  organizationId,
  coachId,
  initialTags,
}: {
  organizationId: string;
  coachId: string;
  initialTags: ClientTagRow[];
}) {
  const [tags, setTags] = useState(initialTags);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error: insertError } = await supabase
      .from("client_tags")
      .insert({ organization_id: organizationId, name, created_by: coachId })
      .select("id, name, gates_revenue_split")
      .single();
    if (insertError || !data) {
      setError(insertError?.code === "23505" ? "That tag already exists." : "Couldn't create that tag — try again.");
      setSubmitting(false);
      return;
    }
    setTags((prev) => [...prev, { id: data.id, name: data.name, gatesRevenueSplit: data.gates_revenue_split }]);
    setNewName("");
    setSubmitting(false);
  }

  async function handleDelete(tagId: string) {
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    const supabase = createBrowserClient();
    await supabase.from("client_tags").delete().eq("id", tagId);
  }

  async function handleSetGate(tagId: string, next: boolean) {
    setTags((prev) => prev.map((t) => ({ ...t, gatesRevenueSplit: t.id === tagId ? next : false })));
    const supabase = createBrowserClient();
    // Unset any other gating tag first — the partial unique index only
    // allows one true value per org at a time, so setting this one true
    // while another is still true would fail the constraint.
    if (next) {
      await supabase
        .from("client_tags")
        .update({ gates_revenue_split: false })
        .eq("organization_id", organizationId)
        .neq("id", tagId);
    }
    await supabase.from("client_tags").update({ gates_revenue_split: next }).eq("id", tagId);
  }

  return (
    <div className="mb-8 border border-steel/20 p-4 max-w-xl">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-2">Client Tags</p>
      <p className="font-body text-xs text-steel mb-3 max-w-[60ch]">
        Organize clients across every group in this organization — &ldquo;In-Home,&rdquo;
        &ldquo;Coast to Coast,&rdquo; whatever makes sense for your business. Assign tags from a
        client&apos;s own profile.
      </p>

      <div className="space-y-2 mb-3">
        {tags.length === 0 && <p className="font-body text-xs text-steel">No tags yet.</p>}
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-3">
            <span className="font-body text-sm flex-1">{tag.name}</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={tag.gatesRevenueSplit}
                onChange={(e) => handleSetGate(tag.id, e.target.checked)}
                className="accent-rust"
              />
              <span className="font-body text-[11px] text-steel uppercase tracking-wide">
                Gates revenue split
              </span>
            </label>
            <button
              type="button"
              onClick={() => handleDelete(tag.id)}
              aria-label={`Delete ${tag.name}`}
              className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {tags.some((t) => t.gatesRevenueSplit) && (
        <p className="font-body text-[11px] text-steel mb-3 max-w-[60ch]">
          Only clients tagged with the gating tag above are included in the org-wide revenue
          split — everyone else&apos;s payments go entirely to their own group&apos;s coach.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="New tag name"
          className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={submitting || !newName.trim()}
          className="h-9 px-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="font-body text-[11px] text-rust mt-2">{error}</p>}
    </div>
  );
}
