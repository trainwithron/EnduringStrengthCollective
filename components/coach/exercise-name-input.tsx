"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampedLeft, clampedWidth } from "@/lib/viewport-clamp";
import type { AliasEntry } from "@/lib/exercise-matching";
import type { DemoRow } from "@/lib/exercise-demo";
import { builderDemoFor } from "@/lib/builder-demo";
import { BuilderDemoThumb } from "@/components/coach/builder-demo-thumb";
import { isExistingExercise, nextActiveIndex, searchExercises } from "@/lib/exercise-search";
import { resolveTypedAlias } from "@/lib/exercise-alias-seed";

export function ExerciseNameInput({
  value,
  onChange,
  onCommit,
  suggestions,
  aliases = [],
  tierByName,
  demoLibrary,
}: {
  value: string;
  onChange: (value: string) => void;
  // Called with the name to save. When the coach picked an exercise through one of their aliases (or typed an alias), the first argument is the REAL exercise and the second is the alias they used
  // (to be shown as the row's name); otherwise the second is undefined.
  onCommit?: (value: string, displayName?: string) => void;
  // The coach's library, most-used first (the page sorts it that way).
  suggestions: string[];
  // Learned raw-name -> real-name aliases (the same self-learning table the CSV/photo importer already writes to). A typed alias lists the real exercise.
  aliases?: AliasEntry[];
  // Same A/B/C movement-pattern-ladder tier every exercise row already resolves by name elsewhere — search and tier-picking become one moment instead of two. Optional/undefined
  // for callers (the ladder-editing screen itself) that don't need it.
  tierByName?: Record<string, "A" | "B" | "C" | null>;
  // The coach's library with its demo links: each row of the list shows a tiny picture of that exercise's demo, so similar names (a row, a press) can be told apart. Optional.
  demoLibrary?: DemoRow[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Guards against the input's own onBlur re-committing a stale closure value right after a row click already committed the new one — both fire in the same tick, before this
  // component re-renders. Cleared on a short timer so it can never swallow a later blur.
  const suggestionClickedRef = useRef(false);

  const trimmed = value.trim();
  // With text, a live list of every library exercise whose name or alias matches it anywhere (best matches first). Empty input keeps the plain browse-everything list.
  const rows = trimmed
    ? searchExercises(trimmed, suggestions, aliases).map((r) => ({ name: r.name, viaAlias: r.viaAlias }))
    : suggestions.slice(0, 6).map((name) => ({ name, viaAlias: null as string | null }));
  // When what was typed is not already an exercise, the last row adds it as a new one.
  const offerAdd = trimmed !== "" && !isExistingExercise(trimmed, suggestions);
  const rowCount = rows.length + (offerAdd ? 1 : 0);
  const showDropdown = open && rowCount > 0;

  // Rendered through a portal to <body>, positioned from the input's real screen coordinates — this input sits inside the Program Builder's horizontally-scrolling week row
  // and each day card, both of which were clipping/garbling a plain absolutely-positioned dropdown. Same fix already proven for program-card-menu.tsx.
  useEffect(() => {
    if (!showDropdown) return;
    function updatePosition() {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) {
        const width = clampedWidth(rect.width, window.innerWidth);
        setPosition({ top: rect.bottom + 4, left: clampedLeft(rect.left, width, window.innerWidth), width });
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

  function pick(name: string, alias?: string | null) {
    suggestionClickedRef.current = true;
    setTimeout(() => {
      suggestionClickedRef.current = false;
    }, 300);
    // the box shows the name the coach chose (their alias when they picked through one); what is saved is the real exercise plus that alias
    onChange(alias ?? name);
    if (alias) onCommit?.(name, alias);
    else onCommit?.(name);
    setOpen(false);
    setActive(-1);
  }

  // Typed text and left (Enter or leaving the box): if it is one of the coach's aliases it is saved as that alias of the real exercise, else exactly as typed.
  function commitTyped(text: string) {
    const alias = resolveTypedAlias(text, suggestions, aliases);
    if (alias) onCommit?.(alias.exerciseName, alias.displayName);
    else onCommit?.(text);
  }

  function pickRow(index: number) {
    if (index < rows.length) pick(rows[index].name, rows[index].viaAlias);
    else pick(trimmed);
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showDropdown && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!showDropdown) {
              setOpen(true);
              return;
            }
            e.preventDefault();
            setActive((a) => nextActiveIndex(e.key as "ArrowDown" | "ArrowUp", a, rowCount));
          } else if (e.key === "Enter") {
            if (showDropdown && active >= 0) {
              e.preventDefault();
              pickRow(active);
            } else {
              // nothing highlighted: Enter keeps what was typed
              e.preventDefault();
              setOpen(false);
              commitTyped(value);
              suggestionClickedRef.current = true;
              setTimeout(() => {
                suggestionClickedRef.current = false;
              }, 300);
            }
          } else if (e.key === "Escape") {
            if (showDropdown) {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }
        }}
        // Delayed so a row's mouse-down fires before this closes the list — the standard fix for the combobox blur race.
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          if (suggestionClickedRef.current) {
            suggestionClickedRef.current = false;
            return;
          }
          commitTyped(value);
        }}
        placeholder="Exercise name"
        aria-label="Exercise name"
        title={value}
        className="w-full h-10 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      {showDropdown && position && typeof document !== "undefined" &&
        createPortal(
          <div
            id={listId}
            role="listbox"
            aria-label="Matching exercises"
            style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
            className="z-50 bg-surface border border-steel/30 max-h-72 overflow-y-auto shadow-lg"
          >
            {rows.map((row, i) => {
              const tier = tierByName?.[row.name];
              return (
                <div
                  key={row.name}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  // keeps the focus in the input, so typing and the arrow keys keep working
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickRow(i);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full flex items-center gap-2 text-left px-3 min-h-11 sm:min-h-9 py-1 font-body text-sm text-chalk cursor-pointer ${active === i ? "bg-graphite" : ""}`}
                >
                  {demoLibrary && <BuilderDemoThumb size="tiny" exerciseName={row.name} demo={builderDemoFor(demoLibrary, row.name)} />}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{row.name}</span>
                    {row.viaAlias && <span className="block text-xs text-steel">also called {row.viaAlias}</span>}
                  </span>
                  {tier && (
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center border border-steel/40 text-steel text-xs font-bold">
                      {tier}
                    </span>
                  )}
                </div>
              );
            })}
            {offerAdd && (
              <div
                id={optionId(rows.length)}
                role="option"
                aria-selected={active === rows.length}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickRow(rows.length);
                }}
                onMouseEnter={() => setActive(rows.length)}
                className={`w-full flex items-center px-3 min-h-11 sm:min-h-9 py-1 font-body text-sm text-rust cursor-pointer border-t border-steel/20 ${active === rows.length ? "bg-graphite" : ""}`}
              >
                <span className="break-words">Add &ldquo;{trimmed}&rdquo; as a new exercise</span>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
