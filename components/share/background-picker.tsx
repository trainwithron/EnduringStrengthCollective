"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Check } from "lucide-react";
import { SCENIC_BACKGROUNDS, type ScenicBackgroundKey } from "@/lib/scenic-backgrounds";
import { ScenicBackground } from "@/components/share/scenic-background";

// share_card_backgrounds_expansion_scoping_sept19.md — a lasting,
// per-athlete pick (profiles.preferred_share_background), not a
// per-post setting, so it's saved to the athlete's own profile rather
// than the post row the way CustomizeSharePanel saves its selection.
export function BackgroundPicker({
  athleteId,
  initialPreference,
}: {
  athleteId: string;
  initialPreference: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialPreference);
  const [saving, setSaving] = useState<string | "auto" | null>(null);
  const router = useRouter();

  async function choose(key: ScenicBackgroundKey | null) {
    setSaving(key ?? "auto");
    const supabase = createBrowserClient();
    await supabase
      .from("profiles")
      .update({ preferred_share_background: key })
      .eq("id", athleteId);
    setSelected(key);
    setSaving(null);
    router.refresh();
  }

  return (
    <div className="mt-4 pt-4 border-t border-steel/20 text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-body text-xs text-steel uppercase tracking-wide"
      >
        {open ? "Done choosing background" : "Choose your background →"}
      </button>

      {open && (
        <div className="mt-3">
          <p className="font-body text-[11px] text-steel mb-2">
            Pick a scene for every future card, or leave it on auto to keep it rotating.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => choose(null)}
              disabled={saving !== null}
              className={`relative h-16 rounded-lg border overflow-hidden flex items-center justify-center bg-surface/60 disabled:opacity-60 ${
                selected === null ? "border-rust" : "border-steel/20"
              }`}
            >
              <span className="font-body text-[10px] text-steel uppercase tracking-wide">Auto</span>
              {selected === null && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rust flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-graphite" strokeWidth={3} />
                </span>
              )}
            </button>
            {SCENIC_BACKGROUNDS.map((bg) => (
              <button
                key={bg.key}
                type="button"
                onClick={() => choose(bg.key)}
                disabled={saving !== null}
                className={`relative h-16 rounded-lg border overflow-hidden disabled:opacity-60 ${
                  selected === bg.key ? "border-rust" : "border-steel/20"
                }`}
                title={bg.label}
              >
                <ScenicBackground background={bg.key} />
                {selected === bg.key && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rust flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-graphite" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
