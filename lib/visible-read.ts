// "Seen it" means seen: a message from the client counts as read only while the page is actually in front of the coach. A message that arrives while the browser tab is in the background, or the
// window is not in focus, stays unread (so the badge lights up); it is marked read the moment the page becomes visible again. Pure, with the document and window passed in so it can be tested.

export interface VisibleDoc {
  visibilityState: string;
  hasFocus?: () => boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}
export interface FocusWin {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}

export const pageIsInFront = (doc: Pick<VisibleDoc, "visibilityState" | "hasFocus">): boolean => doc.visibilityState === "visible" && (doc.hasFocus ? doc.hasFocus() : true);

export function attachVisibleReader(args: { doc: VisibleDoc; win?: FocusWin; markRead: () => void }): { onArrive: () => void; dispose: () => void } {
  const { doc, win, markRead } = args;
  let pending = false;
  const flush = () => {
    if (pending && pageIsInFront(doc)) {
      pending = false;
      markRead();
    }
  };
  doc.addEventListener("visibilitychange", flush);
  win?.addEventListener("focus", flush);
  return {
    onArrive() {
      if (pageIsInFront(doc)) markRead();
      else pending = true;
    },
    dispose() {
      doc.removeEventListener("visibilitychange", flush);
      win?.removeEventListener("focus", flush);
    },
  };
}
