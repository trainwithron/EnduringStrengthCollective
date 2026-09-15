"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchTopN, type AliasEntry } from "@/lib/exercise-matching";

export function ExerciseNameInput({
  value,
  onChange,
  onCommit,
  suggestions,
  aliases = [],
  tierByName,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  suggestions: string[];
  // Learned raw-name -> real-name aliases (the same self-learning table the
  // CSV/photo importer already writes to) — optional so existing callers
  // that don't have this loaded yet still work, just without alias-aware
  // ranking until they thread it through.
  aliases?: AliasEntry[];
  // Same A/B/C movement-pattern-ladder tier every exercise row already
  // resolves by name elsewhere — search and tier-picking become one
  // moment instead of two: a coach sees a suggestion is already a known
  // Tier-A lift without leaving the search field. Optional/undefined for
  // callers (the ladder-editing screen itself) that don't need it.
  tierByName?: Record<string, "A" | "B" | "C" | null>;
}) {
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Guards against the input's own onBlur re-committing a stale closure
  // value right after a suggestion click already committed the new one —
  // both fire in the same tick, before this component re-renders.
  const suggestionClickedRef = useRef(false);

  const trimmed = value.trim();
  // With real input, rank by the same order-invariant/synonym-aware matcher
  // the CSV/photo importer already uses — "ipsilateral lunge" or "alt
  // lunge" now finds the real candidates instead of requiring the exact
  // substring/word-order the library entry happens to use. Empty input
  // keeps the plain alphabetical browse-everything list, unrelated to
  // ranking.
  const library = suggestions.map((name) => ({ name }));
  const filtered = trimmed
    ? matchTopN(trimmed, library, aliases, 3).map((r) => r.exerciseName)
    : suggestions.slice(0, 6);

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
            {filtered.map((name) => {
              const tier = tierByName?.[name];
              return (
                <button
                  key={name}
                  type="button"
                  onMouseDown={() => {
                    suggestionClickedRef.current = true;
                    onChange(name);
                    onCommit?.(name);
                    setFocused(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 h-9 font-body text-sm text-chalk active:bg-graphite"
                >
                  <span className="truncate">{name}</span>
                  {tier && (
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center border border-steel/40 text-steel text-[10px] font-bold">
                      {tier}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
