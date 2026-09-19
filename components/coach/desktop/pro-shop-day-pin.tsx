"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Trash2 } from "lucide-react";

export interface PinnableLink {
  id: string;
  title: string;
}

export interface DayPin {
  id: string;
  linkId: string;
  linkTitle: string;
}

// coach_identity_bio_social_link_pinning_scoping_sept19.md — Ron's own
// example: an intra-workout carb-supplement link pinned to one client's
// heavy-training day. A real, new join (link + client + date) — nothing
// like it existed before this pass.
export function ProShopDayPin({
  athleteId,
  groupId,
  coachId,
  date,
  availableLinks,
  initialPins,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  date: string;
  availableLinks: PinnableLink[];
  initialPins: DayPin[];
}) {
  const router = useRouter();
  const [pins, setPins] = useState(initialPins);
  const [selectedLinkId, setSelectedLinkId] = useState("");
  const [saving, setSaving] = useState(false);

  const unpinnedLinks = availableLinks.filter((l) => !pins.some((p) => p.linkId === l.id));

  async function handlePin() {
    if (!selectedLinkId || saving) return;
    setSaving(true);
    const supabase = createBrowserClient();
    const link = availableLinks.find((l) => l.id === selectedLinkId);
    const { data, error } = await supabase
      .from("pro_shop_link_day_pins")
      .insert({ link_id: selectedLinkId, coach_id: coachId, athlete_id: athleteId, group_id: groupId, pin_date: date })
      .select("id")
      .single();
    setSaving(false);
    if (!error && data && link) {
      setPins((prev) => [...prev, { id: data.id, linkId: link.id, linkTitle: link.title }]);
      setSelectedLinkId("");
      router.refresh();
    }
  }

  async function handleUnpin(pinId: string) {
    const supabase = createBrowserClient();
    await supabase.from("pro_shop_link_day_pins").delete().eq("id", pinId);
    setPins((prev) => prev.filter((p) => p.id !== pinId));
    router.refresh();
  }

  return (
    <section className="border border-steel/20 p-4 mt-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
        Pro Shop link for this day
      </h2>
      <p className="font-body text-xs text-steel mb-3">
        e.g. an intra-workout supplement link on a heavy-training day — shown to this client on this
        specific day only.
      </p>

      {pins.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pins.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 border border-steel/15 px-3 py-2">
              <span className="font-body text-sm text-chalk">{p.linkTitle}</span>
              <button type="button" onClick={() => handleUnpin(p.id)} className="text-steel active:text-rust" aria-label={`Unpin ${p.linkTitle}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {unpinnedLinks.length === 0 ? (
        <p className="font-body text-xs text-steel">
          {availableLinks.length === 0 ? "Add links in Pro Shop first." : "Every link is already pinned."}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selectedLinkId}
            onChange={(e) => setSelectedLinkId(e.target.value)}
            className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
          >
            <option value="">Pick a Pro Shop link…</option>
            {unpinnedLinks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handlePin}
            disabled={!selectedLinkId || saving}
            className="h-9 px-3 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
          >
            {saving ? "Pinning…" : "Pin"}
          </button>
        </div>
      )}
    </section>
  );
}
