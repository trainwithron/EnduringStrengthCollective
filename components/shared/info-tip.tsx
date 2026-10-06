"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampedLeft, clampedWidth, placeVertically } from "@/lib/viewport-clamp";

// The one tap-friendly "what's this?" hint for the whole app. A small "i" button opens a short explanation
// next to it. Built so it can never run off the screen: it is drawn on the page body (so no scrolling or
// clipped parent can cut it, and no inherited no-wrap style can stretch it), its width is the screen minus
// a margin on each side, it flips above the button when there is no room below, and a tap anywhere else (or
// Escape) closes it. It does not dim the page; the invisible layer behind it only catches the outside tap.
const DESIRED_WIDTH = 288;

export function InfoTip({ text, label = "What's this?" }: { text: string; label?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function place() {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = clampedWidth(DESIRED_WIDTH, vw);
    const left = clampedLeft(rect.left + rect.width / 2 - width / 2, width, vw);
    const height = boxRef.current?.offsetHeight ?? 120;
    setPos({ top: placeVertically(rect.top, rect.bottom, height, vh), left, width });
  }

  // Measure after the box is drawn so the vertical placement uses its real height.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onMove() {
      place();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setPos(null);
          setOpen(true);
        }}
        aria-label={label}
        aria-expanded={open}
        className="relative w-3.5 h-3.5 rounded-full border border-steel/40 text-steel text-xs leading-[12px] flex items-center justify-center shrink-0 before:absolute before:-inset-3.5 before:content-['']"
      >
        i
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)}>
            <div
              ref={boxRef}
              role="dialog"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                width: pos?.width ?? clampedWidth(DESIRED_WIDTH, typeof window === "undefined" ? 360 : window.innerWidth),
                visibility: pos ? "visible" : "hidden",
                maxHeight: "calc(100vh - 2rem)",
              }}
              className="fixed overflow-y-auto whitespace-normal break-words bg-graphite border border-steel/40 shadow-xl text-chalk font-body text-sm normal-case tracking-normal font-normal leading-snug p-4"
            >
              {text}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full h-11 mt-3 border border-steel/30 text-steel font-body text-xs"
              >
                Got it
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
