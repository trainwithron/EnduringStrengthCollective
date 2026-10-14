"use client";

import { useState } from "react";
import { AUDIENCES, type Audience } from "@/lib/shelf";

export interface ShelfSettings {
  showOnHome?: boolean;
  showInProShop?: boolean;
  showOnPublic?: boolean;
  audience: Audience;
  audienceGroupId: string | null;
  buyerJoinsSpace?: boolean;
}

const box = "w-4 h-4 accent-[#D2703B]";
const selectClass = "h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs";

// "Where it shows" and "Who sees it in the app" for one package or one Pro Shop card. Every change is saved at once (no Save button) and put back with a plain line if it did not save.
export function ShelfPlacementControls({
  target,
  id,
  initial,
  groups,
  isProgram = false,
  publicChecked,
  onTogglePublic,
}: {
  target: "package" | "link";
  id: string;
  initial: ShelfSettings;
  groups: { id: string; name: string }[];
  // Packages only: a program product can bring its buyer into the coach's client space.
  isProgram?: boolean;
  // Packages only: the Public page checkbox is the package's existing Published setting, saved by the page.
  publicChecked?: boolean;
  onTogglePublic?: () => void;
}) {
  const [s, setS] = useState<ShelfSettings>(initial);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>, next: ShelfSettings) {
    const before = s;
    setS(next);
    setError(null);
    try {
      const response = await fetch("/api/coach/shelf-placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, id, ...patch }),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setS(before);
      setError("That didn't save. Nothing was changed. Try again.");
    }
  }

  function setAudience(audience: Audience, audienceGroupId: string | null) {
    // "One group" waits for a group to be picked before it is saved.
    if (audience === "one_group" && !audienceGroupId) {
      setS({ ...s, audience, audienceGroupId: null });
      return;
    }
    void save({ audience, audienceGroupId }, { ...s, audience, audienceGroupId });
  }

  return (
    <div className="border border-steel/20 bg-surface/30 p-3 space-y-2">
      <p className="font-body text-xs text-steel uppercase tracking-wide">Where it shows</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {target === "package" ? (
          <>
            <label className="inline-flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
              <input type="checkbox" checked={!!publicChecked} onChange={() => onTogglePublic?.()} className={box} />
              Public page
            </label>
            <label className="inline-flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
              <input type="checkbox" checked={!!s.showOnHome} onChange={(e) => void save({ showOnHome: e.target.checked }, { ...s, showOnHome: e.target.checked })} className={box} />
              Client Home
            </label>
            <label className="inline-flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
              <input type="checkbox" checked={!!s.showInProShop} onChange={(e) => void save({ showInProShop: e.target.checked }, { ...s, showInProShop: e.target.checked })} className={box} />
              Pro Shop
            </label>
          </>
        ) : (
          <label className="inline-flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
            <input type="checkbox" checked={!!s.showOnPublic} onChange={(e) => void save({ showOnPublic: e.target.checked }, { ...s, showOnPublic: e.target.checked })} className={box} />
            Show on my public page
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-body text-xs text-steel">Who sees it in the app</span>
        <div className="flex flex-wrap gap-2">
          <select value={s.audience} onChange={(e) => setAudience(e.target.value as Audience, e.target.value === "one_group" ? s.audienceGroupId : null)} aria-label="Who sees it in the app" className={selectClass}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {s.audience === "one_group" && (
            <select value={s.audienceGroupId ?? ""} onChange={(e) => setAudience("one_group", e.target.value || null)} aria-label="Which group" className={selectClass}>
              <option value="">Pick the group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </label>
      {target === "package" && isProgram && (
        <label className="inline-flex items-center gap-2 min-h-11 font-body text-xs text-chalk cursor-pointer">
          <input type="checkbox" checked={s.buyerJoinsSpace !== false} onChange={(e) => void save({ buyerJoinsSpace: e.target.checked }, { ...s, buyerJoinsSpace: e.target.checked })} className={box} />
          Buyer also joins my client space (can message me)
        </label>
      )}
      {target === "package" && <p className="font-body text-xs text-steel">Buy buttons appear on their own once your Stripe account is connected.</p>}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
