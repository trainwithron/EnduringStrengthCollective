"use client";

import { useRef, useState } from "react";

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

  return (
    <div className="relative">
      <input
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
        className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      {showDropdown && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-surface border border-steel/30 max-h-48 overflow-y-auto">
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
        </div>
      )}
    </div>
  );
}
