"use client";

import { useEffect, useRef } from "react";
import { confirmDialog } from "@/components/shared/confirm-dialog";

// What a full-screen sheet or pop-up needs to be usable by keyboard and screen reader, written once: focus moves into it when it opens, Tab and Shift+Tab stay inside it, Escape closes it, and focus goes back to
// what had it before. Put the returned ref on the dialog's outer element together with role="dialog", aria-modal="true" and a label. `screenKey` changes when the dialog swaps to another screen inside itself
// (focus then moves to the first control of the new screen).
//
// Escape never throws work away by accident:
//   - `guard` says what Escape does here: "close" (nothing to lose), "ask" (the person is asked "Discard what you have here?" first) or "block" (work is in flight, Escape does nothing).
//   - Escape that something inside the dialog already used (it called preventDefault: a closing menu, a mention list) does not also close the dialog, and neither does Escape pressed in an open select or a combobox/listbox.
// Several dialogs can be open at once (a sheet that opens a pop-up): only the TOPMOST one answers Escape and Tab, so one Escape closes one thing and the traps never fight. A confirm box on top of a dialog has its own handling and is left alone.
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Where Tab or Shift+Tab goes from `currentIndex` in a list of `count` focusable things: the opposite end when it would leave the dialog, otherwise null (the browser moves focus itself).
export function trapTarget(count: number, currentIndex: number, shift: boolean): "first" | "last" | null {
  if (count === 0) return "first";
  if (shift && currentIndex <= 0) return "last";
  if (!shift && currentIndex === count - 1) return "first";
  return null;
}

export type EscapeAction = "close" | "ask" | "block";
export interface DialogA11yOptions {
  guard?: () => EscapeAction;
  // The words of the "ask" question.
  askMessage?: string;
}

// The dialogs that are open, last one on top.
const openDialogs: symbol[] = [];
// Puts a dialog on top of the others; the returned function takes it off again.
export function pushDialog(token: symbol): () => void {
  openDialogs.push(token);
  return () => {
    const i = openDialogs.indexOf(token);
    if (i >= 0) openDialogs.splice(i, 1);
  };
}
export function topDialogIs(token: symbol): boolean {
  return openDialogs[openDialogs.length - 1] === token;
}
export function openDialogCount(): number {
  return openDialogs.length;
}

// True when an Escape pressed here belongs to a smaller thing inside the dialog (an open select, a combobox or listbox popup) or was already used by one.
export function escapeBelongsToInnerThing(e: Pick<KeyboardEvent, "defaultPrevented" | "target">): boolean {
  if (e.defaultPrevented) return true;
  const target = e.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return false;
  if (target.tagName === "SELECT") return true;
  if (target.closest('[role="listbox"], [role="menu"]')) return true;
  const expanded = target.closest('[aria-expanded="true"][role="combobox"], input[aria-expanded="true"], textarea[aria-expanded="true"]');
  return !!expanded;
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void, screenKey?: unknown, options: DialogA11yOptions = {}) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tokenRef = useRef<symbol>(Symbol("dialog"));

  // What had focus when it opened gets it back when it closes.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Open dialogs are kept in a stack so only the one on top answers the keyboard.
  useEffect(() => {
    if (!open) return;
    return pushDialog(tokenRef.current);
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
      if (!topDialogIs(tokenRef.current)) return;
      if (e.key === "Escape") {
        if (escapeBelongsToInnerThing(e)) return;
        e.stopPropagation();
        const action = optionsRef.current.guard?.() ?? "close";
        if (action === "block") return;
        if (action === "ask") {
          void confirmDialog({ message: optionsRef.current.askMessage ?? "Discard what you have here?", confirmLabel: "Discard", cancelLabel: "Keep working", destructive: true }).then((yes) => {
            if (yes) closeRef.current();
          });
          return;
        }
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && ref.current.contains(active);
      // A confirm box (or any other modal) on top of this dialog has its own Tab handling: leave it alone.
      if (!inside) {
        const other = active?.closest?.('[aria-modal="true"]');
        if (other && other !== ref.current) return;
      }
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      // Tab from outside the dialog pulls focus in.
      if (!inside) {
        e.preventDefault();
        if (items.length === 0) ref.current.focus();
        else (e.shiftKey ? items[items.length - 1] : items[0]).focus();
        return;
      }
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
