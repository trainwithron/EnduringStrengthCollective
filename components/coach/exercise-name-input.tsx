"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ExerciseNameInput({
  value,
  onChange,
  onCommit,
  suggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  suggestions: string[];
}) {
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Guards against the input's own onBlur re-committing a stale closure
  // value right after a suggestion click already committed the new one —
  // both fire in the same tick, before this component re-renders.
  const suggestionClickedRef = useRef(false);

  const trimmed = value.trim().toLowerCase();
  const filtered = (
    trimmed
      ? suggestions.filter((s) => s.toLowerCase().includes(trimmed))
      : suggestions
  ).slice(0, 6);

  const showDropdown = focused && filtered.length > 0;

  // Rendered through a portal to <body>, positioned from the input's real
  // screen coordinates — this input sits inside the Program Builder's
  // horizontally-scrolling week row (week-grid.tsx's overflow-x-auto) and
  // each day card, both of which were clipping/garbling a plain
  // absolutely-positioned dropdown against whatever sat below it (the
  // tracked-fields grid). Same fix already proven for program-card-menu.tsx
  // hitting the identical overflow-hidden clipping class of bug.
  useEffect(() => {
    if (!showDropdown) return;
    function updatePosition() {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) {
        setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showDropdown]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delayed so a suggestion's onMouseDown fires before this closes
        // the dropdown — the standard fix for the combobox blur race.
        onBlur={() => {
          setTimeout(() => setFocused(false), 150);
          if (suggestionClickedRef.current) {
            suggestionClickedRef.current = false;
            return;
          }
          onCommit?.(value);
        }}
        placeholder="Exercise name"
        aria-label="Exercise name"
        className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      {showDropdown && position && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
            className="z-50 bg-surface border border-steel/30 max-h-48 overflow-y-auto shadow-lg"
          >
            {filtered.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={() => {
                  suggestionClickedRef.current = true;
                  onChange(name);
                  onCommit?.(name);
                  setFocused(false);
                }}
                className="block w-full text-left px-3 h-9 font-body text-sm text-chalk active:bg-graphite"
              >
                {name}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
