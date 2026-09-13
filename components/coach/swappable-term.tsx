"use client";

import { useState } from "react";
import { useTerminology } from "./terminology-provider";
import { resolveTerm, TERM_DEFAULTS, TERM_PRESETS, type TermForm, type TermKey } from "@/lib/terminology";

const TOAST_SEEN_KEY = "terminology-toast-seen";

// The inline word-swap affordance (coach_dashboard_redesign_scoping.md,
// refined per Ron's own direction): a dotted underline, not a dropdown-
// shaped box — the word looks like plain text until you interact with
// it. Click reveals a minimal, borderless-feeling inline list (default +
// presets + a "Custom…" free-text escape hatch) right at the word, not a
// heavy menu. Picking anything applies as one coach-wide (per-org)
// preference, wherever this same termKey is used across the app — the
// in-context click is just the discovery moment for that global setting.
export function SwappableTerm({
  termKey,
  form = "singular",
  className = "",
}: {
  termKey: TermKey;
  form?: TermForm;
  className?: string;
}) {
  const { overrides, setOverride } = useTerminology();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const text = resolveTerm(overrides, termKey, form);

  function showToastOnce(newLabel: string) {
    let seen = false;
    try {
      seen = window.localStorage.getItem(TOAST_SEEN_KEY) === "1";
    } catch {
      // Storage unavailable — just skip the one-time toast, not fatal.
    }
    if (seen) return;
    setToast(
      `Renamed "${TERM_DEFAULTS[termKey].plural}" to "${newLabel}" throughout your dashboard — click any label to change it back.`
    );
    try {
      window.localStorage.setItem(TOAST_SEEN_KEY, "1");
    } catch {
      // Non-fatal — the toast just might show again next time.
    }
    setTimeout(() => setToast(null), 6000);
  }

  function pickPreset(e: React.MouseEvent, value: string) {
    e.preventDefault();
    e.stopPropagation();
    const preset = TERM_PRESETS[termKey].find((p) => p.value === value);
    setOverride(termKey, { kind: "preset", value });
    setOpen(false);
    setCustomOpen(false);
    if (preset) showToastOnce(preset.plural);
  }

  function pickDefault(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOverride(termKey, null);
    setOpen(false);
    setCustomOpen(false);
  }

  function submitCustom(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = customText.trim();
    if (!trimmed) return;
    setOverride(termKey, { kind: "custom", value: trimmed });
    setOpen(false);
    setCustomOpen(false);
    setCustomText("");
    showToastOnce(trimmed);
  }

  // Every handler below calls BOTH preventDefault and stopPropagation:
  // this word can render inside a <Link> (nav items), and stopPropagation
  // alone does not cancel the anchor's native navigation — only
  // preventDefault does. Confirmed live: without preventDefault here, a
  // real click on a nav SwappableTerm silently navigated the whole nav
  // link instead of just opening the picker.
  return (
    <span className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="underline decoration-dotted decoration-steel/50 underline-offset-4 hover:decoration-rust focus:outline-none"
      >
        {text}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
            aria-hidden="true"
          />
          <div className="absolute z-30 top-full left-0 mt-1 bg-graphite border border-steel/30 py-1 min-w-[110px] shadow-lg">
            <button
              type="button"
              onClick={pickDefault}
              className="w-full text-left px-3 py-1 font-body text-xs text-chalk active:text-rust whitespace-nowrap"
            >
              {TERM_DEFAULTS[termKey][form]}
            </button>
            {TERM_PRESETS[termKey].map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={(e) => pickPreset(e, p.value)}
                className="w-full text-left px-3 py-1 font-body text-xs text-chalk active:text-rust whitespace-nowrap"
              >
                {p[form]}
              </button>
            ))}
            {customOpen ? (
              <div className="px-2 py-1 flex items-center gap-1">
                <input
                  autoFocus
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCustom(e);
                  }}
                  placeholder="Custom"
                  className="w-20 h-6 bg-surface border border-steel/30 text-chalk px-1 font-body text-xs"
                />
                <button type="button" onClick={submitCustom} className="font-body text-xs text-rust">
                  ✓
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCustomOpen(true);
                }}
                className="w-full text-left px-3 py-1 font-body text-xs text-steel whitespace-nowrap"
              >
                Custom…
              </button>
            )}
          </div>
        </>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-rust/40 px-4 py-2 max-w-sm text-center">
          <p className="font-body text-xs text-chalk">{toast}</p>
        </div>
      )}
    </span>
  );
}
