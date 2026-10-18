"use client";

import { useEffect, useRef } from "react";

// What a full-screen sheet or pop-up needs to be usable by keyboard and screen reader, written once: focus moves into it when it opens, Tab and Shift+Tab stay inside it, Escape closes it, and focus goes back to
// what had it before. Put the returned ref on the dialog's outer element together with role="dialog", aria-modal="true" and a label. `screenKey` changes when the dialog swaps to another screen inside itself
// (focus then moves to the first control of the new screen).
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Where Tab or Shift+Tab goes from `currentIndex` in a list of `count` focusable things: the opposite end when it would leave the dialog, otherwise null (the browser moves focus itself).
export function trapTarget(count: number, currentIndex: number, shift: boolean): "first" | "last" | null {
  if (count === 0) return "first";
  if (shift && currentIndex <= 0) return "last";
  if (!shift && currentIndex === count - 1) return "first";
  return null;
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void, screenKey?: unknown) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // What had focus when it opened gets it back when it closes.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (node) {
      if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      // A field the screen already focused for the person (autoFocus) keeps it; otherwise focus goes to the first control.
      if (!node.contains(document.activeElement) || document.activeElement === node) {
        const first = node.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? node).focus();
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const target = trapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (target === null) return;
      e.preventDefault();
      if (items.length === 0) ref.current.focus();
      else (target === "first" ? items[0] : items[items.length - 1]).focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, screenKey]);

  return ref;
}
