// The in-page "are you sure?" that replaces the browser's own confirm popup (which takes over the whole browser window and says "spotlightcoaching.app says"). One store, one dialog mounted once in
// the root layout (components/shared/confirm-dialog.tsx); any handler asks with `await confirmDialog("Delete this?")` and gets true or false, exactly like window.confirm did. Pure, so it is tested without a
// browser. Requests are answered one at a time, in order; a second ask while one is open waits its turn.

export interface ConfirmOptions {
  message: string;
  // Words on the buttons. Taken from the message when not given ("Delete ...?" -> Delete).
  confirmLabel?: string;
  cancelLabel?: string;
  // Red confirm button, and the focus starts on Cancel. Taken from the message when not given (delete, remove, cancel, revoke, clear, discard, end, hold).
  destructive?: boolean;
  // An optional tick-box in the same dialog (for example a second choice that belongs to the question). Its answer comes back with askWithChoice.
  checkbox?: { label: string; checked?: boolean };
}

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  checkbox: { label: string; checked: boolean } | null;
}

const DESTRUCTIVE = /\b(delete|remove|cancel|revoke|clear|discard|end this|put all|lost|lose|can't be undone|cannot be undone)\b/i;

// Wording for the buttons from what the message is about. A message that starts with "Cancel" gets "Yes, cancel" / "Keep it" so the two buttons are never both "Cancel".
export function describeConfirm(options: string | ConfirmOptions): ConfirmRequest {
  const o: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  const message = o.message;
  const first = message.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  // Only the question itself decides the red button: a later sentence that says what is NOT touched ("nothing is cancelled") is not a reason to warn.
  const question = message.includes("?") ? message.slice(0, message.indexOf("?") + 1) : message;
  const destructive = o.destructive ?? DESTRUCTIVE.test(question);
  let confirmLabel = o.confirmLabel;
  let cancelLabel = o.cancelLabel;
  if (!confirmLabel) {
    if (first === "cancel") {
      confirmLabel = "Yes, cancel";
      cancelLabel = cancelLabel ?? "Keep it";
    } else if (["delete", "remove", "revoke", "clear"].includes(first)) {
      confirmLabel = first.charAt(0).toUpperCase() + first.slice(1);
    } else if (first === "close") {
      confirmLabel = "Discard";
    } else {
      confirmLabel = "Confirm";
    }
  }
  return { message, confirmLabel, cancelLabel: cancelLabel ?? "Cancel", destructive, checkbox: o.checkbox ? { label: o.checkbox.label, checked: !!o.checkbox.checked } : null };
}

interface Pending {
  request: ConfirmRequest;
  resolve: (answer: boolean, checked: boolean) => void;
}

export function createConfirmStore() {
  const queue: Pending[] = [];
  const listeners = new Set<() => void>();
  let snapshot: ConfirmRequest | null = null;
  const publish = () => {
    snapshot = queue[0]?.request ?? null;
    for (const l of listeners) l();
  };
  return {
    ask(options: string | ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        queue.push({ request: describeConfirm(options), resolve: (answer) => resolve(answer) });
        if (queue.length === 1) publish();
      });
    },
    // Like ask, but also says whether the dialog's tick-box was ticked when the person confirmed.
    askWithChoice(options: ConfirmOptions): Promise<{ confirmed: boolean; checked: boolean }> {
      return new Promise((resolve) => {
        queue.push({ request: describeConfirm(options), resolve: (answer, checked) => resolve({ confirmed: answer, checked }) });
        if (queue.length === 1) publish();
      });
    },
    // The dialog's answer for the one on screen; the next waiting ask (if any) shows straight after.
    answer(value: boolean, checked = false) {
      const current = queue.shift();
      if (!current) return;
      current.resolve(value, value && checked);
      publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}

export const confirmStore = createConfirmStore();
