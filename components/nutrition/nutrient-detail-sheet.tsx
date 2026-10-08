"use client";

import { useEffect, useRef, useState } from "react";
import { NutrientDetailView, type NutrientDetailFacts } from "@/components/nutrition/nutrient-detail-view";

// One nutrient in depth, opened OVER the food log (a panel from the side on a computer, a sheet from the bottom on a phone) instead of taking the person to another page. It asks the
// server for the facts when it opens (today's figures are already saved by then), and shows the same body as the nutrient's own page. Esc, the Close button, or a tap outside closes it.
export function NutrientDetailSheet({
  groupId,
  athleteId,
  audience,
  nutrientKey,
  label,
  onClose,
}: {
  groupId: string;
  athleteId: string;
  audience: "client" | "coach";
  nutrientKey: string;
  label: string;
  onClose: () => void;
}) {
  const [facts, setFacts] = useState<NutrientDetailFacts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFacts(null);
    setProblem(null);
    const params = new URLSearchParams({ groupId, key: nutrientKey });
    if (audience === "coach") params.set("athleteId", athleteId);
    fetch(`/api/nutrients/detail?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("bad");
        return (await res.json()) as NutrientDetailFacts;
      })
      .then((data) => {
        if (!cancelled) setFacts(data);
      })
      .catch(() => {
        if (!cancelled) setProblem("Couldn't load this just now. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, athleteId, audience, nutrientKey]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end" data-testid="nutrient-sheet">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-graphite/70" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nutrient-sheet-title"
        className="relative w-full md:w-[560px] max-h-[88vh] md:max-h-none md:h-full overflow-y-auto bg-graphite border-t md:border-t-0 md:border-l border-steel/30 p-5 pb-10"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="nutrient-sheet-title" className="font-display font-bold text-2xl uppercase leading-none">
              {label}
            </h2>
            {facts && <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">{facts.detail.nutrient.why}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 h-11 px-4 border border-steel/40 font-body text-sm text-chalk">
            Close
          </button>
        </div>
        {problem ? (
          <p className="font-body text-sm text-rust" role="alert">
            {problem}
          </p>
        ) : !facts ? (
          <p className="font-body text-sm text-steel" role="status">
            Loading…
          </p>
        ) : (
          <NutrientDetailView facts={facts} />
        )}
      </div>
    </div>
  );
}
