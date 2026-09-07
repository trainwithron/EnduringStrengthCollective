"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function PrListToggle({
  items,
}: {
  items: { name: string; weight: number; reps: number; oneRepMax: number }[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mt-6 border-t border-rust/30 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between font-display uppercase text-sm text-rust tracking-wide"
      >
        <span>
          New PR{items.length > 1 ? "s" : ""} 🎉 ({items.length})
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {items.map((pr) => (
            <div key={pr.name} className="text-left">
              <p className="font-display text-lg uppercase">{pr.name}</p>
              <p className="font-body text-sm text-steel">
                {pr.weight} lbs &times; {pr.reps}
                <span className="text-rust"> &middot; est. 1RM {pr.oneRepMax} lbs</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
