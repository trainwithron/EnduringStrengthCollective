"use client";

import { CARD_SIZE_LABELS, type CardSize } from "@/lib/card-size";

export function CardSizeToggle({
  size,
  onChange,
}: {
  size: CardSize;
  onChange: (size: CardSize) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-body text-xs text-steel uppercase tracking-wide">Card size</span>
      <div className="flex border border-steel/30">
        {(["small", "medium", "large"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={size === s}
            title={s[0].toUpperCase() + s.slice(1)}
            className={`w-7 h-7 font-body text-xs transition-colors ${
              size === s ? "bg-rust text-graphite" : "text-steel active:text-chalk"
            }`}
          >
            {CARD_SIZE_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
