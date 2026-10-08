// What a dialog that says aria-modal has to DO, kept apart from React so it can be tested without a browser: focus goes in when it opens and comes back to what opened it when it closes,
// Tab cycles inside it instead of wandering into the page behind, Esc closes it, and the page behind does not scroll while it is open.

export interface FocusableLike {
  focus(): void;
}
export interface DialogLike {
  querySelectorAll(selector: string): ArrayLike<FocusableLike>;
}
export interface KeyEventLike {
  key: string;
  shiftKey?: boolean;
  preventDefault(): void;
}
export interface DocLike {
  activeElement: unknown;
  body: { style: { overflow: string } };
  addEventListener(type: "keydown", listener: (e: KeyEventLike) => void): void;
  removeEventListener(type: "keydown", listener: (e: KeyEventLike) => void): void;
}

export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const canFocus = (x: unknown): x is FocusableLike => !!x && typeof (x as FocusableLike).focus === "function";

// Starts the behaviour and returns the function that undoes it. `getOnClose` is read when Esc is pressed, so a parent that passes a new function on every render never restarts this.
export function attachModal(args: { doc: DocLike; dialog: DialogLike; getOnClose: () => () => void; initialFocus?: FocusableLike | null }): () => void {
  const { doc, dialog, getOnClose, initialFocus } = args;
  const opener = doc.activeElement;
  const previousOverflow = doc.body.style.overflow;
  doc.body.style.overflow = "hidden";
  initialFocus?.focus();

  const onKey = (e: KeyEventLike) => {
    if (e.key === "Escape") {
      getOnClose()();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    const inside = items.some((x) => x === active);
    if (!inside) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  doc.addEventListener("keydown", onKey);

  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.body.style.overflow = previousOverflow;
    if (canFocus(opener)) opener.focus();
  };
}
