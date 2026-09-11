"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2, Plus } from "lucide-react";

export interface StatFieldRow {
  id: string;
  name: string;
  sortOrder: number;
}

export function StatFieldManager({
  groupId,
  initialFields,
}: {
  groupId: string;
  initialFields: StatFieldRow[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const supabase = createBrowserClient();
    const nextOrder = fields.length > 0 ? Math.max(...fields.map((f) => f.sortOrder)) + 1 : 0;
    const { data } = await supabase
      .from("group_stat_fields")
      .insert({ group_id: groupId, name: trimmed, sort_order: nextOrder })
      .select("id, name, sort_order")
      .single();
    if (data) {
      setFields((prev) => [...prev, { id: data.id, name: data.name, sortOrder: data.sort_order }]);
      setName("");
      router.refresh();
    }
    setBusy(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this stat category? Any entered values for it are lost.")) return;
    const supabase = createBrowserClient();
    await supabase.from("group_stat_fields").delete().eq("id", id);
    setFields((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  return (
    <div className="border border-steel/20 p-3 mb-4">
      <p className="font-display uppercase text-xs tracking-wide text-steel mb-2">Stat categories</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {fields.map((f) => (
          <span key={f.id} className="h-7 px-2 border border-steel/30 flex items-center gap-1.5 font-body text-xs">
            {f.name}
            <button type="button" onClick={() => handleDelete(f.id)} aria-label={`Delete ${f.name}`} className="text-steel active:text-rust">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="e.g. Tackles"
          className="h-8 w-40 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="h-8 px-2.5 border border-steel/30 text-rust font-body text-xs flex items-center gap-1 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
