"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Check } from "lucide-react";

export interface ShareCandidateLift {
  name: string;
  weight: number;
  reps: number;
}

export function CustomizeSharePanel({
  postId,
  candidates,
  initialSelected,
}: {
  postId: string;
  candidates: ShareCandidateLift[];
  initialSelected: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase
      .from("posts")
      .update({ shared_exercise_names: Array.from(selected) })
      .eq("id", postId);
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mt-6 pt-4 border-t border-steel/20 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-body text-xs text-steel uppercase tracking-wide"
      >
        {open ? "Done customizing" : "Customize what's shown →"}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="font-body text-[11px] text-steel">
            Basic stats always show. Pick which of today's top sets show too.
          </p>
          {candidates.map((c) => {
            const isSelected = selected.has(c.name);
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => toggle(c.name)}
                className="w-full flex items-center justify-between py-1.5"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 shrink-0 border flex items-center justify-center ${
                      isSelected ? "bg-rust border-rust" : "border-steel/30"
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-graphite" strokeWidth={3} />}
                  </span>
                  <span className="font-display text-sm uppercase">{c.name}</span>
                </span>
                <span className="font-body text-xs text-steel">
                  {c.weight} lbs &times; {c.reps}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full h-9 mt-2 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save selection"}
          </button>
        </div>
      )}
    </div>
  );
}
